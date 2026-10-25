import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/types/auth.types';
import { appendJsonRules, jsonOutputRules, promptInstructions, parseDocumentKind, type DocumentKind } from '../deepseek/json-rules';
import { DEFAULT_PROMPT, answerPromptLengthError } from '@anchorproposal/shared';
import { defaultDocumentDisplay, type DocumentDisplay } from '../generations/document-display';
import { parseExperienceTitleMode, type ExperienceTitleMode } from '../generations/experience-title-mode';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  static readonly PROMPT_MODE_KEY = 'prompt_assignment_mode';
  static readonly BUILTIN_DEFAULT_PROMPT_ID = 'e17b921b-41c9-4b4a-83c1-1dfd6c7b687c';
  static readonly ANSWER_PROMPT_KEY = 'answer_prompt';
  static readonly DEFAULT_ANSWER_PROMPT = [
    'Continue this same conversation. You already wrote the resume above.',
    '',
    'I will ask job-application questions next, one at a time. Answer each later question as the candidate, using only facts from that resume and profile. Do not rewrite the resume. Do not answer any question in this reply.',
    '',
    'Reply to this message with only the single word: yes',
  ].join('\n');


  private promptSelect = {
    id: true, name: true, content: true, version: true, isPublished: true,
    isInitial: true, isPersonalDefault: true, documentKind: true,
    experienceTitleMode: true, ownerId: true,
  } as const;

  async getPromptAssignmentMode(user?: { id: string; role: string }): Promise<'user' | 'profile' | 'separate'> {
    if (!user) return 'profile';
    const saved = await this.prisma.user.findUnique({ where: { id: user.id } });
    return saved?.generationPromptMode === 'user' ? 'user' : saved?.generationPromptMode === 'separate' ? 'separate' : 'profile';
  }

  async setPromptAssignmentMode(user: AuthUser, mode: 'user' | 'profile' | 'separate') {
    if (!['user', 'profile', 'separate'].includes(mode)) throw new BadRequestException('Choose one of the three generation ways.');
    await this.prisma.user.update({ where: { id: user.id }, data: { generationPromptMode: mode } });
    return { mode };
  }

  /** A default is always a real prompt record owned only by this user. */
  async resolvePromptForUser(user: { id: string; role: string }, _options?: { profileId?: string }) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const saved = await tx.user.findUnique({ where: { id: user.id } });
      if (!saved) throw new NotFoundException('User not found');
      const selected = saved.selectedPromptId ? await tx.promptVersion.findFirst({ where: { id: saved.selectedPromptId, ownerId: user.id, isPublished: true, archivedAt: null } }) : null;
      if (selected) return selected;
      const prompt = await tx.promptVersion.upsert({
        where: { ownerId_sourcePromptId: { ownerId: user.id, sourcePromptId: 'builtin-personal-default' } }, update: {},
        create: { ownerId: user.id, sourcePromptId: 'builtin-personal-default', name: 'My all-profile prompt',
          content: appendJsonRules(DEFAULT_PROMPT), isPersonalDefault: true, isPublished: true, publishedAt: new Date(), documentKind: 'combined' },
      });
      const active = prompt.archivedAt ? await tx.promptVersion.update({ where: { id: prompt.id }, data: { archivedAt: null, isPublished: true } }) : prompt;
      await tx.user.update({ where: { id: user.id }, data: { selectedPromptId: active.id, useMasterPrompt: false } });
      return active;
    });
  }

  async listManagedPrompts(actor: AuthUser) {
    return this.prisma.promptVersion.findMany({ where: { ownerId: actor.id, isPersonalDefault: false, archivedAt: null }, orderBy: { updatedAt: 'desc' }, select: this.promptSelect });
  }

  async listAssignablePrompts(actor: AuthUser) {
    return this.prisma.promptVersion.findMany({ where: { ownerId: actor.id, isPublished: true, isPersonalDefault: false, archivedAt: null }, orderBy: { name: 'asc' }, select: this.promptSelect });
  }

  async assertAssignablePrompts(actor: AuthUser, ids: string[]) {
    for (const id of [...new Set(ids)]) await this.usablePersonalPrompt(id, actor.id);
  }

  async createLibraryPrompt(actor: AuthUser, data: { name: string; content: string; experienceTitleMode?: ExperienceTitleMode; documentKind?: DocumentKind }) {
    const name = data.name?.trim(); const instructions = typeof data.content === 'string' ? promptInstructions(data.content) : '';
    if (!name || name.length > 200) throw new BadRequestException('Enter a prompt name (up to 200 characters).');
    if (!instructions || instructions.length > 80000) throw new BadRequestException('Enter prompt instructions (up to 80,000 characters).');
    const experienceTitleMode = parseExperienceTitleMode(data.experienceTitleMode);
    let documentKind: DocumentKind;
    try { documentKind = parseDocumentKind(data.documentKind); } catch (error) { throw new BadRequestException((error as Error).message); }
    const latest = await this.prisma.promptVersion.findFirst({ where: { ownerId: actor.id }, orderBy: { version: 'desc' } });
    return this.prisma.promptVersion.create({ data: { ownerId: actor.id, name, documentKind, experienceTitleMode,
      content: appendJsonRules(instructions, documentKind, experienceTitleMode), version: (latest?.version || 0) + 1,
      isPublished: true, publishedAt: new Date() }, select: this.promptSelect });
  }

  async updateLibraryPrompt(actor: AuthUser, id: string, data: { name?: string; content?: string; experienceTitleMode?: ExperienceTitleMode; documentKind?: DocumentKind }) {
    const prompt = await this.usablePersonalPrompt(id, actor.id);
    const instructions = promptInstructions(data.content ?? prompt.content);
    const name = (data.name ?? prompt.name).trim();
    if (!name || name.length > 200 || !instructions || instructions.length > 80000) throw new BadRequestException('Enter a prompt name and non-empty instructions.');
    const experienceTitleMode = parseExperienceTitleMode(data.experienceTitleMode ?? prompt.experienceTitleMode);
    if (prompt.isPersonalDefault && experienceTitleMode !== 'saved') throw new BadRequestException('The all-profile prompt uses saved positions.');
    let documentKind: DocumentKind;
    try { documentKind = parseDocumentKind(data.documentKind ?? prompt.documentKind); } catch (error) { throw new BadRequestException((error as Error).message); }
    return this.prisma.promptVersion.update({ where: { id }, data: { name, documentKind, experienceTitleMode, content: appendJsonRules(instructions, documentKind, experienceTitleMode) }, select: this.promptSelect });
  }

  async deleteLibraryPrompt(actor: AuthUser, id: string) {
    await this.usablePersonalPrompt(id, actor.id);
    await this.prisma.$transaction(async tx => {
      await tx.promptVersion.update({ where: { id }, data: { archivedAt: new Date(), isPublished: false } });
      await tx.profileGenerationPreference.updateMany({ where: { userId: actor.id, resumePromptId: id }, data: { resumePromptId: null } });
      await tx.profileGenerationPreference.updateMany({ where: { userId: actor.id, coverLetterPromptId: id }, data: { coverLetterPromptId: null } });
      await tx.user.updateMany({ where: { id: actor.id, selectedPromptId: id }, data: { selectedPromptId: null } });
    });
    return { success: true, id };
  }

  async publishOwnPrompt(actor: AuthUser, id: string) {
    const prompt = await this.prisma.promptVersion.findFirst({ where: { id, ownerId: actor.id, archivedAt: null } });
    if (!prompt) throw new NotFoundException('Your prompt was not found');
    return this.prisma.promptVersion.update({ where: { id }, data: { isPublished: true, publishedAt: new Date() } });
  }

  private async usablePersonalPrompt(id: string, userId: string) {
    const prompt = await this.prisma.promptVersion.findFirst({ where: { id, ownerId: userId, isPublished: true, archivedAt: null } });
    if (!prompt) throw new BadRequestException('Choose an active prompt from your own prompt library.');
    return prompt;
  }

  async resolveGenerationPrompt(user: { id: string; role: string }, profileId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    const profileName = [profile.firstName, profile.lastName].join(' ').trim();
    const mode = await this.getPromptAssignmentMode(user);
    if (mode === 'user') {
      const prompt = await this.resolvePromptForUser(user);
      return { usedDefault: false, experienceTitleMode: 'saved' as const, promptName: prompt.name, profileName, prompt, coverLetterPrompt: undefined };
    }
    const preference = await this.getProfileGenerationPreference(profileId, user as AuthUser);
    if (!preference.resumePromptId) throw new BadRequestException('Choose ' + (mode === 'profile' ? 'a combined' : 'a resume') + ' prompt for ' + profileName + ' in Settings.');
    const prompt = await this.usablePersonalPrompt(preference.resumePromptId, user.id);
    if (mode === 'profile' && prompt.documentKind === 'cover-letter') throw new BadRequestException('Choose a combined resume + cover-letter prompt for this profile.');
    const coverLetterPrompt = mode === 'separate' && preference.coverLetterPromptId ? await this.usablePersonalPrompt(preference.coverLetterPromptId, user.id) : undefined;
    if (mode === 'separate' && !coverLetterPrompt) throw new BadRequestException('Assign both a resume prompt and a cover letter prompt for ' + profileName + ' in Settings.');
    return { usedDefault: false, experienceTitleMode: parseExperienceTitleMode(prompt.experienceTitleMode), promptName: prompt.name, profileName, prompt, coverLetterPrompt };
  }

  async getMyPromptSettings(user: AuthUser) {
    const prompt = await this.resolvePromptForUser(user);
    return { role: user.role, assignmentMode: await this.getPromptAssignmentMode(user), useMasterPrompt: false,
      promptSource: 'custom' as const, masterPrompt: null, myPrompt: prompt, effectivePrompt: prompt,
      myPrompts: await this.listManagedPrompts(user), assignedPrompts: [], profilePrompts: [], selectedPromptId: prompt.id };
  }

  async updateMyPromptSettings(user: AuthUser, data: { mode?: 'user' | 'profile' | 'separate'; content?: string; resetToDefault?: boolean }) {
    if (!data || (data.mode === undefined && data.content === undefined && !data.resetToDefault)) throw new BadRequestException('Choose a generation way or enter prompt instructions.');
    if (data.mode !== undefined && !['user', 'profile', 'separate'].includes(data.mode)) throw new BadRequestException('Choose one of the three generation ways.');
    if (data.resetToDefault && data.content !== undefined) throw new BadRequestException('Choose either starter instructions or custom instructions.');
    const instructions = data.resetToDefault ? DEFAULT_PROMPT : data.content !== undefined ? promptInstructions(data.content) : undefined;
    if (instructions !== undefined && (!instructions || instructions.length > 80000)) throw new BadRequestException('Enter non-empty prompt instructions (up to 80,000 characters).');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      let selectedPromptId: string | undefined;
      if (instructions !== undefined) {
        const latest = await tx.promptVersion.findFirst({ where: { ownerId: user.id }, orderBy: { version: 'desc' } });
        const created = await tx.promptVersion.create({ data: { ownerId: user.id, name: 'My all-profile prompt', isPersonalDefault: true,
          content: appendJsonRules(instructions), documentKind: 'combined', isPublished: true, publishedAt: new Date(), version: (latest?.version || 0) + 1 } });
        selectedPromptId = created.id;
      }
      await tx.user.update({ where: { id: user.id }, data: { useMasterPrompt: false, ...(data.mode ? { generationPromptMode: data.mode } : {}), ...(selectedPromptId ? { selectedPromptId } : {}) } });
    });
    return this.getMyPromptSettings(user);
  }

  async getProfileGenerationPreference(profileId: string, user: AuthUser) {
    return await this.prisma.profileGenerationPreference.findUnique({ where: { userId_profileId: { userId: user.id, profileId } } }) || { resumePromptId: null, coverLetterPromptId: null };
  }

  async saveProfileGenerationPreference(profileId: string, user: AuthUser, data: { resumePromptId?: string | null; coverLetterPromptId?: string | null }) {
    for (const id of [data.resumePromptId, data.coverLetterPromptId]) {
      if (id !== undefined && id !== null && (typeof id !== 'string' || !id)) throw new BadRequestException('Invalid prompt selection');
      if (id) await this.usablePersonalPrompt(id, user.id);
    }
    return this.prisma.profileGenerationPreference.upsert({ where: { userId_profileId: { userId: user.id, profileId } }, create: { userId: user.id, profileId, ...data }, update: data });
  }

  async getGenerationWorkflow(user: AuthUser) {
    const settings = await this.getMyPromptSettings(user);
    const profiles = await this.prisma.profile.findMany({
      where: { archivedAt: null, ...(user.role === 'BIDDER' ? { assignments: { some: { userId: user.id, activeTo: null } } } : {}) },
      select: { id: true, firstName: true, lastName: true, profileTitle: true, generationPreferences: { where: { userId: user.id }, select: { resumePromptId: true, coverLetterPromptId: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return { mode: settings.assignmentMode, defaultPrompt: settings.effectivePrompt, prompts: settings.myPrompts,
      profiles: profiles.map(profile => ({ id: profile.id, name: [profile.firstName, profile.lastName].join(' '), title: profile.profileTitle, ...(profile.generationPreferences[0] || { resumePromptId: null, coverLetterPromptId: null }) })),
      jsonRules: { combined: jsonOutputRules('combined'), resume: jsonOutputRules('resume'), 'cover-letter': jsonOutputRules('cover-letter') },
      documentDisplay: await this.getDocumentDisplay(user.id) };
  }

  async getDocumentDisplay(userId?: string): Promise<DocumentDisplay> {
    if (!userId) return { ...defaultDocumentDisplay };
    const saved = await this.prisma.systemSetting.findUnique({ where: { key: `document_display:${userId}` } });
    try { const value = JSON.parse(saved?.value || '{}'); return { showJobTitle: typeof value.showJobTitle === 'boolean' ? value.showJobTitle : true }; }
    catch { return { ...defaultDocumentDisplay }; }
  }

  async updateDocumentDisplay(user: AuthUser, data: DocumentDisplay) {
    if (!data || typeof data.showJobTitle !== 'boolean') throw new BadRequestException('Choose whether the header job title is visible or hidden.');
    const display = { showJobTitle: data.showJobTitle };
    await this.prisma.systemSetting.upsert({ where: { key: `document_display:${user.id}` }, create: { key: `document_display:${user.id}`, value: JSON.stringify(display) }, update: { value: JSON.stringify(display) } });
    return display;
  }

  async getAiSettings() {
    const key = await this.getApiKey();
    const model = await this.prisma.systemSetting.findUnique({ where: { key: 'deepseek_model' } });
    return {
      hasApiKey: !!key,
      model: model?.value || 'deepseek-v4-flash',
    };
  }

  async updateAiSettings(data: { apiKey?: string; model?: string }) {
    if (!data || (data.apiKey !== undefined && typeof data.apiKey !== 'string') ||
        (data.model !== undefined && typeof data.model !== 'string')) {
      throw new BadRequestException('API key and model must be text');
    }
    const apiKey = data.apiKey?.trim();
    if (apiKey) {
      await this.prisma.systemSetting.upsert({
        where: { key: 'deepseek_api_key' },
        create: { key: 'deepseek_api_key', value: apiKey },
        update: { value: apiKey },
      });
    }
    if (data.model) {
      await this.prisma.systemSetting.upsert({
        where: { key: 'deepseek_model' },
        create: { key: 'deepseek_model', value: data.model },
        update: { value: data.model },
      });
    }
    return this.getAiSettings();
  }

  async getApiKey(): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'deepseek_api_key' } });
    // Settings and every provider call must use the same Master-managed key.
    return setting?.value?.trim() || null;
  }

  async requireApiKey(): Promise<string> {
    const key = await this.getApiKey();
    if (!key) {
      throw new BadRequestException('AI generation is unavailable. Ask Master to save a DeepSeek API key in Settings → AI Provider.');
    }
    return key;
  }

  async getModel(): Promise<string> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'deepseek_model' } });
    return setting?.value || 'deepseek-v4-flash';
  }

  async getAnswerPrompt(userId: string): Promise<string> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: `${SettingsService.ANSWER_PROMPT_KEY}:${userId}` },
    });
    const value = setting?.value?.trim();
    return value || SettingsService.DEFAULT_ANSWER_PROMPT;
  }

  async setAnswerPrompt(prompt: string, userId: string): Promise<string> {
    if (typeof prompt !== 'string') throw new BadRequestException('Answer instructions must be text.');
    const value = prompt.trim() || SettingsService.DEFAULT_ANSWER_PROMPT;
    const lengthError = answerPromptLengthError(value);
    if (lengthError) throw new BadRequestException(lengthError);
    await this.prisma.systemSetting.upsert({
      where: { key: `${SettingsService.ANSWER_PROMPT_KEY}:${userId}` },
      create: { key: `${SettingsService.ANSWER_PROMPT_KEY}:${userId}`, value },
      update: { value },
    });
    return value;
  }
}
