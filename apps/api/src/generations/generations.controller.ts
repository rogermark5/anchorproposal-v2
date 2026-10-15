import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GenerationsService, ManualGenerationInput } from './generations.service';
import { AnswersService } from './answers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../common/types/auth.types';
import type { ExperienceTitleMode } from './experience-title-mode';

@Controller()
@UseGuards(JwtAuthGuard)
export class GenerationsController {
  constructor(
    private generationsService: GenerationsService,
    private answersService: AnswersService,
  ) {}

  @Get('applications/:id/generation-prompt')
  previewGenerationPrompt(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.generationsService.previewGenerationPrompt(id, req.user);
  }

  @Post('applications/:id/generations')
  startGeneration(
    @Param('id') id: string,
    @Body() body: { templateId?: string; idempotencyKey?: string; experienceTitleMode?: ExperienceTitleMode },
    @Req() req: { user: AuthUser },
  ) {
    return this.generationsService.startGeneration(id, req.user, body.templateId, body.idempotencyKey, body.experienceTitleMode);
  }

  @Post('applications/:id/generations/stream')
  async streamDesktop(
    @Param('id') id: string,
    @Body() body: { templateId?: string; idempotencyKey?: string; experienceTitleMode?: ExperienceTitleMode },
    @Req() req: { user: AuthUser }, @Res() res: Response,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8 * 60_000);
    const onClose = () => controller.abort();
    res.on('close', onClose);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const emit = (event: Record<string, unknown>) => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n'); }, 15_000);
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try { await this.generationsService.streamDesktopGeneration(id, req.user, body, controller.signal, emit); }
    catch (error) {
      if (!res.headersSent && !res.destroyed) throw error;
      emit({ stage: 'failed', message: controller.signal.aborted ? 'Generation timed out or was cancelled.' : error instanceof Error ? error.message : 'Generation failed.' });
    } finally {
      clearTimeout(timeout); if (heartbeat) clearInterval(heartbeat);
      res.off('close', onClose);
      if (res.headersSent && !res.writableEnded) res.end();
    }
  }

  @Get('applications/:id/manual-generation-prompt')
  previewManualGeneration(
    @Param('id') id: string,
    @Query('templateId') templateId: string | undefined,
    @Query('experienceTitleMode') experienceTitleMode: ExperienceTitleMode | undefined,
    @Req() req: { user: AuthUser },
  ) {
    return this.generationsService.previewManualGeneration(id, req.user, templateId, experienceTitleMode);
  }

  @Post('applications/:id/generations/manual')
  importManualGeneration(
    @Param('id') id: string,
    @Body() body: ManualGenerationInput,
    @Req() req: { user: AuthUser },
  ) {
    return this.generationsService.importManualGeneration(id, req.user, body);
  }

  @Get('applications/:id/generations')
  listByApplication(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.generationsService.findByApplication(id, req.user);
  }

  @Get('generations/:id')
  findOne(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.generationsService.findOne(id, req.user);
  }

  @Get('generations/:id/preview')
  previewHtml(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.generationsService.previewHtml(id, req.user);
  }

  @Post('generations/:id/public-link')
  share(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.generationsService.createPublicLink(id, req.user);
  }

  @Post('generations/:id/draft-preview')
  previewEdits(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthUser }) {
    return this.generationsService.previewEdits(id, req.user, body);
  }

  @Post('generations/:id/edits')
  saveEdits(@Param('id') id: string, @Body() body: unknown, @Req() req: { user: AuthUser }) {
    return this.generationsService.saveEdits(id, req.user, body);
  }

  @Delete('generations/:id/public-link')
  revoke(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.generationsService.revokePublicLink(id, req.user);
  }

  @Get('generations/:id/answers')
  listAnswers(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.answersService.list(id, req.user);
  }

  @Post('generations/:id/answers/prompt')
  primeAnswers(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.answersService.prime(id, req.user);
  }

  @Post('generations/:id/answers')
  askAnswer(
    @Param('id') id: string,
    @Body('question') question: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.answersService.ask(id, req.user, question);
  }

  @Post('generations/:id/export')
  exportFile(
    @Param('id') id: string,
    @Body() body: { kind?: 'RESUME' | 'COVER_LETTER'; type?: 'PDF' | 'DOCX' },
    @Req() req: { user: AuthUser },
  ) {
    return this.generationsService.exportFile(
      id,
      req.user,
      body.kind as 'RESUME' | 'COVER_LETTER',
      body.type as 'PDF' | 'DOCX',
    );
  }
}
