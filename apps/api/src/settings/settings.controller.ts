import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';
import type { ExperienceTitleMode } from '../generations/experience-title-mode';
import type { DocumentKind } from '../deepseek/json-rules';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('time-zone')
  getTimeZone(@Req() req: { user: AuthUser }) {
    return this.settingsService.getTimeZone(req.user.id);
  }

  @Patch('time-zone')
  setTimeZone(@Body('timeZone') timeZone: unknown, @Req() req: { user: AuthUser }) {
    return this.settingsService.setTimeZone(req.user.id, timeZone);
  }

  /** Master initial prompt list */
  @Get('prompts')
  @Roles(UserRole.MASTER)
  getPrompts(@Req() req: { user: AuthUser }) {
    return this.settingsService.listManagedPrompts(req.user);
  }

  @Post('prompts')
  @Roles(UserRole.MASTER)
  createPrompt(@Body('content') content: string, @Req() req: { user: AuthUser }) {
    return this.settingsService.createLibraryPrompt(req.user, { content, name: 'My prompt' });
  }

  @Post('prompts/:id/publish')
  @Roles(UserRole.MASTER)
  publishPrompt(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.settingsService.publishOwnPrompt(req.user, id);
  }

  @Patch('prompts/:id')
  @Roles(UserRole.MASTER)
  updatePrompt(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: { user: AuthUser },
    @Body('name') name?: string,
  ) {
    return this.settingsService.updateLibraryPrompt(req.user, id, { content, name });
  }

  @Delete('prompts/:id')
  @Roles(UserRole.MASTER)
  deletePrompt(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.settingsService.deleteLibraryPrompt(req.user, id);
  }

  /** Every role manages only its own private prompt library. */
  @Get('prompt-library')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  listPromptLibrary(@Req() req: { user: AuthUser }, @Query('scope') scope?: string) {
    if (scope === 'assign') return this.settingsService.listAssignablePrompts(req.user);
    return this.settingsService.listManagedPrompts(req.user);
  }

  @Post('prompt-library')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  createLibraryPrompt(
    @Body() body: { name: string; content: string; experienceTitleMode?: ExperienceTitleMode; documentKind?: DocumentKind },
    @Req() req: { user: AuthUser },
  ) {
    return this.settingsService.createLibraryPrompt(req.user, body);
  }

  @Patch('prompt-library/:id')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  updateLibraryPrompt(
    @Param('id') id: string,
    @Body() body: { name?: string; content?: string; experienceTitleMode?: ExperienceTitleMode; documentKind?: DocumentKind },
    @Req() req: { user: AuthUser },
  ) {
    return this.settingsService.updateLibraryPrompt(req.user, id, body);
  }

  @Delete('prompt-library/:id')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  deleteLibraryPrompt(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.settingsService.deleteLibraryPrompt(req.user, id);
  }

  @Get('prompt-mode')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  getPromptMode(@Req() req: { user: AuthUser }) {
    return this.settingsService.getPromptAssignmentMode(req.user).then((mode) => ({ mode }));
  }

  @Patch('prompt-mode')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  setPromptMode(@Body('mode') mode: 'user' | 'profile' | 'separate', @Req() req: { user: AuthUser }) {
    return this.settingsService.setPromptAssignmentMode(req.user, mode);
  }

  /** Effective / my prompt for Admin, Bidder (and Master for convenience) */
  @Get('my-prompt')
  getMyPrompt(@Req() req: { user: AuthUser }) {
    return this.settingsService.getMyPromptSettings(req.user);
  }

  @Get('generation-workflow')
  generationWorkflow(@Req() req: { user: AuthUser }) {
    return this.settingsService.getGenerationWorkflow(req.user);
  }

  @Patch('my-prompt')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  updateMyPrompt(
    @Body()
    body: {
      mode?: 'user' | 'profile' | 'separate';
      content?: string;
      resetToDefault?: boolean;
    },
    @Req() req: { user: AuthUser },
  ) {
    return this.settingsService.updateMyPromptSettings(req.user, body);
  }

  @Patch('document-display')
  updateDocumentDisplay(@Body() body: { showJobTitle: boolean }, @Req() req: { user: AuthUser }) {
    return this.settingsService.updateDocumentDisplay(req.user, body);
  }

  @Get('ai')
  @Roles(UserRole.MASTER)
  getAiSettings() {
    return this.settingsService.getAiSettings();
  }

  @Patch('ai')
  @Roles(UserRole.MASTER)
  updateAiSettings(@Body() body: { apiKey?: string; model?: string }) {
    return this.settingsService.updateAiSettings(body);
  }

  @Get('answer-prompt')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  getAnswerPrompt(@Req() req: { user: AuthUser }) {
    return this.settingsService.getAnswerPrompt(req.user.id).then((prompt) => ({ prompt }));
  }

  @Patch('answer-prompt')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  setAnswerPrompt(@Body('prompt') prompt: string, @Req() req: { user: AuthUser }) {
    return this.settingsService.setAnswerPrompt(prompt, req.user.id).then((value) => ({ prompt: value }));
  }
}
