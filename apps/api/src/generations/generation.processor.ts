import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationsService } from './generations.service';
import { DeepseekService } from '../deepseek/deepseek.service';
import { GenerationStatus } from '@prisma/client';
import type { GenerationOutput } from '@anchorproposal/shared';
import { parseExperienceTitleMode } from './experience-title-mode';

@Processor('resume-generation')
export class GenerationProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private generationsService: GenerationsService,
    private deepseek: DeepseekService,
  ) {
    super();
  }

  async process(job: Job<{ generationId: string; applicationId: string }>) {
    const { generationId } = job.data;

    try {
      await this.generationsService.updateStatus(generationId, GenerationStatus.VALIDATING);

      const generation = await this.prisma.resumeGeneration.findUnique({
        where: { id: generationId },
        include: { promptVersion: true, templateVersion: true, application: true },
      });
      if (!generation) throw new Error('Generation not found');
      if (!generation.promptSnapshot && !generation.promptVersion?.content) {
        throw new Error('No published prompt version available');
      }

      const prompt = this.deepseek.buildPrompt(generation.promptSnapshot || generation.promptVersion!.content, {
        profileJson: JSON.stringify(generation.profileSnapshotJson),
        jobTitle: generation.application.jobTitle,
        company: generation.application.company,
        jobDescription: generation.application.jobDescription,
        experienceTitleMode: parseExperienceTitleMode(generation.experienceTitleMode),
        documentKind: generation.coverLetterPromptSnapshot ? 'resume' : 'combined',
      });

      await this.generationsService.updateStatus(generationId, GenerationStatus.GENERATING);
      const profileSnap = generation.profileSnapshotJson as {
        firstName?: string;
        lastName?: string;
        profileTitle?: string | null;
        experiences?: Record<string, unknown>[];
      };
      const candidateName =
        `${profileSnap.firstName || ''} ${profileSnap.lastName || ''}`.trim() || undefined;
      const { content, tokenUsage, transcript } = await this.deepseek.generate(prompt, {
        experienceTitleMode: parseExperienceTitleMode(generation.experienceTitleMode),
        profileSnapshot: profileSnap,
        jobTitle: generation.application.jobTitle,
        company: generation.application.company,
        candidateName,
        profileTitle: profileSnap.profileTitle || undefined,
        profileExperiences: Array.isArray(profileSnap.experiences)
          ? profileSnap.experiences
          : undefined,
        coverLetterPrompt: generation.coverLetterPromptSnapshot ? this.deepseek.buildPrompt(generation.coverLetterPromptSnapshot, {
          profileJson: JSON.stringify(generation.profileSnapshotJson), jobTitle: generation.application.jobTitle,
          company: generation.application.company, jobDescription: generation.application.jobDescription,
          documentKind: 'cover-letter',
        }) : undefined,
      });
      const output = content as GenerationOutput;

      const existingTurns = await this.prisma.generationTurn.count({
        where: { generationId, purpose: 'resume_assistant' },
      });
      if (!existingTurns) {
        await this.prisma.generationTurn.createMany({
          data: transcript.map((turn, index) => ({
            generationId,
            sequence: index + 1,
            role: turn.role,
            purpose:
              turn.role === 'system'
                ? 'resume_system'
                : turn.role === 'user'
                  ? 'resume_user'
                  : 'resume_assistant',
            content: turn.content,
          })),
        });
      }

      await this.generationsService.updateStatus(generationId, GenerationStatus.COMPLETED, {
        structuredOutputJson: output,
        tokenUsage,
        costEstimate: tokenUsage * 0.00001,
      });

      await this.prisma.auditEvent.create({
        data: {
          action: 'RESUME_GENERATED',
          targetType: 'ResumeGeneration',
          targetId: generationId,
          actorId: generation.creatorId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.generationsService.updateStatus(generationId, GenerationStatus.FAILED, {
        errorMessage: message,
      });
      throw error;
    }
  }
}
