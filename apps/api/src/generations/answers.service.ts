import { BadRequestException, Injectable, Optional, NotFoundException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GenerationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { DeepseekService } from '../deepseek/deepseek.service';
import { GenerationsService } from './generations.service';
import { AuthUser } from '../common/types/auth.types';
import { readableAnswer } from '@anchorproposal/shared';

type StoredTurn = {
  sequence: number;
  role: string;
  purpose: string;
  content: string;
};

export type AnswerView = {
  primed: boolean;
  ack: string | null;
  items: { question: string; answer: string }[];
  pending?: { id: string; question: string; status: string } | null;
};

@Injectable()
export class AnswersService {
  private tails = new Map<string, Promise<void>>();

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private deepseek: DeepseekService,
    private generations: GenerationsService,
    @Optional() @InjectQueue('application-answers') private queue?: Queue,
  ) {}

  private async deliver(id: string) {
    if (!this.queue) throw new BadRequestException('Answer processing is unavailable.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.queue.add('answer', { requestId: id }, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: { age: 604800, count: 10000 }, removeOnFail: { age: 604800, count: 10000 } }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new ServiceUnavailableException('Answer processing is reconnecting. Your question is saved; retry shortly.')), 5000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async submit(generationId: string, user: AuthUser, question: string, key: string) {
    await this.loadReady(generationId, user);
    if (typeof question !== 'string' || !question.trim() || question.trim().length > 4000 || typeof key !== 'string' || !/^[\w-]{16,100}$/.test(key)) throw new BadRequestException('Enter a question and a valid request key.');
    if (!this.queue) throw new BadRequestException('Answer processing is unavailable.');
    const requestKey = `${user.id}:${generationId}:${key}`;
    const row = await this.prisma.generationAnswerRequest.upsert({ where: { requestKey }, create: { requestKey, generationId, creatorId: user.id, question: question.trim() }, update: {} }).catch(async error => {
      if (error?.code !== 'P2002') throw error;
      const existing = await this.prisma.generationAnswerRequest.findUnique({ where: { requestKey } });
      if (!existing) throw error;
      return existing;
    });
    if (row.question !== question.trim()) throw new ConflictException('This question request key was already used.');
    if (row.status === 'QUEUED') await this.deliver(row.id);
    return { id: row.id, status: row.status };
  }

  async requestStatus(generationId: string, id: string, user: AuthUser) {
    await this.loadReady(generationId, user);
    const row = await this.prisma.generationAnswerRequest.findFirst({ where: { id, generationId, creatorId: user.id } });
    if (!row) throw new NotFoundException('Answer request not found.');
    if (row.status === 'QUEUED') await this.deliver(row.id);
    return { id: row.id, status: row.status, errorMessage: row.errorMessage, ...(row.status === 'COMPLETED' ? { view: await this.list(generationId, user) } : {}) };
  }

  async processRequest(id: string) {
    const row = await this.prisma.generationAnswerRequest.findUnique({ where: { id } });
    if (!row || ['COMPLETED', 'FAILED'].includes(row.status)) return;
    const user = await this.prisma.user.findUnique({ where: { id: row.creatorId } });
    try {
      if (!user || user.status !== 'ACTIVE') throw new Error('This account is no longer active.');
      await this.prisma.generationAnswerRequest.update({ where: { id }, data: { status: 'RUNNING', errorMessage: null } });
      await this.ask(row.generationId, user, row.question, id);
      await this.prisma.generationAnswerRequest.update({ where: { id }, data: { status: 'COMPLETED', errorMessage: null } });
    } catch (error) {
      await this.prisma.generationAnswerRequest.updateMany({ where: { id, status: { not: 'COMPLETED' } }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Could not generate the answer.' } });
      throw error;
    }
  }

  async list(generationId: string, user: AuthUser): Promise<AnswerView> {
    const generation = await this.loadReady(generationId, user);
    const view = this.toView(await this.listTurns(generation.id));
    if (this.queue) view.pending = await this.prisma.generationAnswerRequest.findFirst({ where: { generationId, creatorId: user.id, status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'asc' }, select: { id: true, question: true, status: true } });
    return view;
  }

  /** Sends the settings answer prompt once. The model is asked to reply only yes. */
  async prime(generationId: string, user: AuthUser): Promise<AnswerView> {
    return this.enqueue(generationId, async () => {
      const generation = await this.loadReady(generationId, user);
      await this.ensureResumeConversation(generation);
      const turns = await this.listTurns(generation.id);
      if (this.toView(turns).primed) return this.toView(turns);
      const prompt = await this.settings.getAnswerPrompt(user.id);
      await this.appendExchange(generation.id, turns, prompt, 'answer_prompt', 'answer_ack');
      return this.toView(await this.listTurns(generation.id));
    });
  }

  /** One question, one model call, appended to the same resume conversation. */
  async ask(generationId: string, user: AuthUser, question: string, requestId?: string): Promise<AnswerView> {
    const text = question?.trim();
    if (!text) throw new BadRequestException('Enter a question');
    if (text.length > 4_000) throw new BadRequestException('Question is too long');

    return this.enqueue(generationId, async () => {
      const generation = await this.loadReady(generationId, user);
      if (requestId && await this.prisma.generationTurn.findFirst({ where: { generationId, requestId, purpose: 'answer' } })) return this.toView(await this.listTurns(generationId));
      await this.ensureResumeConversation(generation);
      let turns = await this.listTurns(generation.id);
      if (!this.toView(turns).primed) {
        const prompt = await this.settings.getAnswerPrompt(user.id);
        await this.appendExchange(generation.id, turns, prompt, 'answer_prompt', 'answer_ack');
        turns = await this.listTurns(generation.id);
      }
      await this.appendExchange(generation.id, turns, text, 'question', 'answer', requestId);
      return this.toView(await this.listTurns(generation.id));
    });
  }

  private enqueue<T>(generationId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(generationId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.then(
        () => undefined,
        () => undefined,
      );
    this.tails.set(generationId, tail);
    void tail.finally(() => { if (this.tails.get(generationId) === tail) this.tails.delete(generationId); });
    return run;
  }

  private async loadReady(generationId: string, user: AuthUser) {
    const generation = await this.generations.getAccessibleGeneration(generationId, user);
    if (generation.status !== GenerationStatus.COMPLETED || !generation.structuredOutputJson) {
      throw new BadRequestException('The resume is not ready yet');
    }
    if (generation.requiresRegeneration) throw new BadRequestException('Generate a new resume version using the saved profile before asking application questions.');
    return generation;
  }

  private async listTurns(generationId: string): Promise<StoredTurn[]> {
    return this.prisma.generationTurn.findMany({
      where: { generationId },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, role: true, purpose: true, content: true },
    });
  }

  private toView(turns: StoredTurn[]): AnswerView {
    const ack = [...turns].reverse().find((turn) => turn.purpose === 'answer_ack');
    const items: { question: string; answer: string }[] = [];
    let pending: string | null = null;
    for (const turn of turns) {
      if (turn.purpose === 'question') pending = turn.content;
      else if (turn.purpose === 'answer' && pending !== null) {
        items.push({ question: pending, answer: readableAnswer(turn.content) });
        pending = null;
      }
    }
    return { primed: Boolean(ack), ack: ack?.content ?? null, items };
  }

  /** Older resumes have no saved chat. Rebuild a thread from the stored resume so answers can still continue. */
  private async ensureResumeConversation(generation: {
    id: string;
    structuredOutputJson: unknown;
    profileSnapshotJson: unknown;
    application: { jobTitle: string; company: string; jobDescription: string };
  }) {
    const existing = await this.prisma.generationTurn.count({
      where: { generationId: generation.id, purpose: 'resume_assistant' },
    });
    if (existing > 0) return;

    const profileJson = JSON.stringify(generation.profileSnapshotJson ?? {}, null, 2).slice(0, 80_000);
    const description = (generation.application.jobDescription || '').slice(0, 40_000);
    await this.prisma.generationTurn.createMany({
      data: [
        {
          generationId: generation.id,
          sequence: 1,
          role: 'system',
          purpose: 'resume_system',
          content:
            'You are a professional resume writer continuing an earlier conversation. The resume you already wrote is the following assistant message. Later questions must stay consistent with that resume and the candidate profile.',
        },
        {
          generationId: generation.id,
          sequence: 2,
          role: 'user',
          purpose: 'resume_user',
          content: [
            'This continues the resume you already generated.',
            `Job title: ${generation.application.jobTitle}`,
            `Company: ${generation.application.company}`,
            'Job description:',
            description,
            'Candidate profile JSON:',
            profileJson,
            'The next assistant message is the resume you produced. Stay consistent with it.',
          ].join('\n\n'),
        },
        {
          generationId: generation.id,
          sequence: 3,
          role: 'assistant',
          purpose: 'resume_assistant',
          content: JSON.stringify(generation.structuredOutputJson),
        },
      ],
    });
  }

  private async appendExchange(
    generationId: string,
    prior: StoredTurn[],
    userContent: string,
    userPurpose: string,
    assistantPurpose: string,
    requestId?: string,
  ) {
    const messages = prior.map((turn) => ({
      role: turn.role as 'system' | 'user' | 'assistant',
      content: turn.content,
    }));
    messages.push({ role: 'system', content: 'The resume generation stage is finished. For application questions, reply in readable plain text. Answer all questions in order, separated by blank lines. Do not return a JSON object, JSON array, or markdown code fence. Use a hyphen (-) instead of an em dash.' });
    messages.push({ role: 'user', content: userContent });
    const { content, tokenUsage } = await this.deepseek.completeChat(messages);
    const start = prior.reduce((max, turn) => Math.max(max, turn.sequence), 0);
    const exchange = {
      data: [
        {
          generationId,
          sequence: start + 1,
          role: 'user',
          purpose: userPurpose,
          ...(requestId ? { requestId } : {}),
          content: userContent,
        },
        {
          generationId,
          sequence: start + 2,
          role: 'assistant',
          purpose: assistantPurpose,
          ...(requestId ? { requestId } : {}),
          content: readableAnswer(content),
        },
      ],
    };
    if (requestId) {
      // Save the exchange and its receipt together. A restarted worker can replay
      // the request without making another model call or adding duplicate turns.
      await this.prisma.$transaction(async tx => {
        await tx.generationTurn.createMany(exchange);
        await tx.generationAnswerRequest.update({ where: { id: requestId }, data: { status: 'COMPLETED', errorMessage: null } });
        const generation = await tx.resumeGeneration.findUnique({ where: { id: generationId }, select: { tokenUsage: true, costEstimate: true } });
        await tx.resumeGeneration.update({ where: { id: generationId }, data: { tokenUsage: (generation?.tokenUsage || 0) + tokenUsage, costEstimate: (generation?.costEstimate || 0) + tokenUsage * 0.00001 } });
      });
      return;
    }
    await this.prisma.generationTurn.createMany(exchange);
    const generation = await this.prisma.resumeGeneration.findUnique({ where: { id: generationId } });
    await this.prisma.resumeGeneration.update({
      where: { id: generationId },
      data: {
        tokenUsage: (generation?.tokenUsage ?? 0) + tokenUsage,
        costEstimate: (generation?.costEstimate ?? 0) + tokenUsage * 0.00001,
      },
    });
  }
}
