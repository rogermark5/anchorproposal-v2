import { BadRequestException, Injectable } from '@nestjs/common';
import { GenerationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { DeepseekService } from '../deepseek/deepseek.service';
import { GenerationsService } from './generations.service';
import { AuthUser } from '../common/types/auth.types';

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
};

@Injectable()
export class AnswersService {
  private tails = new Map<string, Promise<void>>();

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private deepseek: DeepseekService,
    private generations: GenerationsService,
  ) {}

  async list(generationId: string, user: AuthUser): Promise<AnswerView> {
    const generation = await this.loadReady(generationId, user);
    return this.toView(await this.listTurns(generation.id));
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
  async ask(generationId: string, user: AuthUser, question: string): Promise<AnswerView> {
    const text = question?.trim();
    if (!text) throw new BadRequestException('Enter a question');
    if (text.length > 4_000) throw new BadRequestException('Question is too long');

    return this.enqueue(generationId, async () => {
      const generation = await this.loadReady(generationId, user);
      await this.ensureResumeConversation(generation);
      let turns = await this.listTurns(generation.id);
      if (!this.toView(turns).primed) {
        const prompt = await this.settings.getAnswerPrompt(user.id);
        await this.appendExchange(generation.id, turns, prompt, 'answer_prompt', 'answer_ack');
        turns = await this.listTurns(generation.id);
      }
      await this.appendExchange(generation.id, turns, text, 'question', 'answer');
      return this.toView(await this.listTurns(generation.id));
    });
  }

  private enqueue<T>(generationId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(generationId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    this.tails.set(
      generationId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
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
        items.push({ question: pending, answer: turn.content });
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
  ) {
    const messages = prior.map((turn) => ({
      role: turn.role as 'system' | 'user' | 'assistant',
      content: turn.content,
    }));
    messages.push({ role: 'user', content: userContent });
    const { content, tokenUsage } = await this.deepseek.completeChat(messages);
    const start = prior.reduce((max, turn) => Math.max(max, turn.sequence), 0);
    await this.prisma.generationTurn.createMany({
      data: [
        {
          generationId,
          sequence: start + 1,
          role: 'user',
          purpose: userPurpose,
          content: userContent,
        },
        {
          generationId,
          sequence: start + 2,
          role: 'assistant',
          purpose: assistantPurpose,
          content,
        },
      ],
    });
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
