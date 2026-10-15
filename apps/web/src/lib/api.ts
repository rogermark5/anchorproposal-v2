import { desktopBridge } from './desktop-bridge';
import { downloadFilename } from './download-filename';
const API_URL = process.env.NEXT_PUBLIC_API_URL || '/backend';

export type ExperienceTitleMode = 'saved' | 'tailored';
export type DocumentKind = 'combined' | 'resume' | 'cover-letter';
export type PrivatePrompt = { id: string; name: string; content: string; documentKind: DocumentKind; experienceTitleMode: ExperienceTitleMode; version: number; isPublished: boolean };
export type GenerationWorkflow = {
  mode: 'user' | 'profile' | 'separate'; defaultPrompt: PrivatePrompt; prompts: PrivatePrompt[];
  profiles: { id: string; name: string; title: string | null; resumePromptId: string | null; coverLetterPromptId: string | null }[];
  jsonRules: Record<DocumentKind, string>;
  documentDisplay?: { showJobTitle: boolean };
};

export type ResumeDocument = { contact: { name: string; title?: string; email?: string; phone?: string; address?: string }; summary: string; skills: Record<string, string>[]; experiences: Record<string, unknown>[]; educations: Record<string, unknown>[]; certificates: Record<string, unknown>[]; coverLetter?: { greeting: string; paragraphs: string[]; closing: string; signatureName?: string } };
export type DocumentEdits = { summary: string; skills: Record<string, string>[]; experiences: { title: string; bullets: string[] }[]; educations: { degree: string; institution: string; dates: string; location?: string }[]; certificates: { name: string; issuer: string; date: string }[]; coverLetter?: { greeting: string; paragraphs: string[]; closing: string }; idempotencyKey?: string };
export type GenerationDocumentPreview = { html: string; pageSize: string; coverLetterHtml?: string | null; content?: ResumeDocument; canEdit?: boolean; generationId?: string; version?: number };

export type UserRole = 'MASTER' | 'ADMIN' | 'BIDDER';

export type DesktopPackageKind = 'setup' | 'portable';
export type DesktopReleaseFile = { version: string; bytes: number; sha256: string; publishedAt: string; downloadPath?: string };
export type DesktopRelease = { id: string; version: string; notes: string; published: boolean; createdAt: string; publishedAt: string | null;
  downloads: Record<DesktopPackageKind, DesktopReleaseFile | null>; uploaded?: Record<DesktopPackageKind, boolean> };
export type DesktopCatalog = { latestId: string | null; releases: DesktopRelease[] };

export interface ManualGenerationPrompt {
  experienceTitleMode: ExperienceTitleMode;
  prompt: string;
  contextHash: string;
  templateId: string;
  usedDefault: boolean;
  promptName: string;
  profileName: string;
  coverLetterPrompt?: string | null;
}

export interface ApplicationOption {
  id: string;
  type: 'LOCATION' | 'SOURCE';
  value: string;
  normalizedValue: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface User {
  id: string;
  email: string;
  username?: string | null;
  role: UserRole;
  firstName: string;
  lastName: string;
  canCreateApplications?: boolean;
  canGenerateResumes?: boolean;
  canDownloadDocuments?: boolean;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private cacheEpoch = 0;

  invalidateCache() { this.cache.clear(); this.pending.clear(); this.cacheEpoch++; }

  constructor() {
    if (typeof window !== 'undefined' && !desktopBridge()) {
      this.accessToken = localStorage.getItem('accessToken');
      this.refreshToken = localStorage.getItem('refreshToken');
    }
  }

  setTokens(access: string, refresh: string) {
    this.invalidateCache();
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  }

  clearTokens() {
    this.invalidateCache();
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  getAccessToken() {
    return this.accessToken;
  }

  private refreshSession(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const token = this.refreshToken;
    this.refreshPromise = (async () => {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ refreshToken: token }),
      });
      // A logout or a new login while this request was pending wins.
      if (this.refreshToken !== token) return;
      if (!response.ok) {
        this.clearTokens();
        if (typeof window !== 'undefined') window.location.href = '/login';
        throw new Error('Session expired');
      }
      const tokens = await this.parseJson<{ accessToken: string; refreshToken: string }>(response);
      if (this.refreshToken === token) this.setTokens(tokens.accessToken, tokens.refreshToken);
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = options.method || 'GET';
    const cacheable = method === 'GET' && /^\/(profiles(?:\?|$)|templates(?:\?|$)|users(?:\?|$)|settings\/|dashboard\/|applications(?:\?|$))/.test(path) && !/preview/.test(path);
    if (method !== 'GET') this.invalidateCache();
    if (!cacheable) {
      try { return await this.performRequest<T>(path, options); }
      finally { if (method !== 'GET') this.invalidateCache(); }
    }
    const epoch = this.cacheEpoch;
    const cached = this.cache.get(path);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value) as T;
    let pending = this.pending.get(path);
    if (!pending) {
      pending = this.performRequest<T>(path, options).then(value => {
        if (epoch === this.cacheEpoch) this.cache.set(path, { value, expires: Date.now() + 15_000 });
        return value;
      }).finally(() => { if (epoch === this.cacheEpoch) this.pending.delete(path); });
      this.pending.set(path, pending);
    }
    return structuredClone(await pending) as T;
  }

  private async performRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const desktop = desktopBridge();
    if (desktop) {
      if (options.body instanceof FormData) {
        const file = options.body.get('file');
        if (!(file instanceof File)) throw new Error('Choose a file to upload.');
        return desktop.upload(path, { name: file.name, type: file.type, bytes: await file.arrayBuffer() });
      }
      return desktop.request(path, options.method || 'GET', typeof options.body === 'string' ? JSON.parse(options.body) : undefined);
    }
    const headers: Record<string, string> = {
      ...(typeof FormData !== 'undefined' && options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      // Free ngrok serves an HTML/text interstitial to browser-like clients unless skipped.
      'ngrok-skip-browser-warning': 'true',
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    const doFetch = (init?: RequestInit) =>
      fetch(`${API_URL}${path}`, {
        ...options,
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      });

    let res = await doFetch();

    if (res.status === 401 && this.refreshToken) {
      // Concurrent page requests share one refresh; late 401s reuse the new token.
      if (headers.Authorization === `Bearer ${this.accessToken}`) await this.refreshSession();
      if (!this.accessToken) throw new Error('Session expired');
      headers.Authorization = `Bearer ${this.accessToken}`;
      res = await doFetch();
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(Array.isArray(err.message) ? err.message[0] : err.message);
    }

    if (res.status === 204) return {} as T;
    return this.parseJson<T>(res);
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Invalid API response (check ngrok / API proxy)');
    }
  }

  login(email: string, password: string) {
    return this.request<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  requestRegisterOtp(data: {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
  }) {
    return this.request<{ requiresOtp: boolean; email: string; message: string }>(
      '/auth/register/request-otp',
      { method: 'POST', body: JSON.stringify(data) },
    );
  }

  verifyRegister(email: string, code: string) {
    return this.request<{ success: boolean; message: string; user: User }>('/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
  }

  forgotPassword(email: string) {
    return this.request<{ success: boolean; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  resetPassword(token: string, password: string, confirmPassword: string) {
    return this.request<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password, confirmPassword }),
    });
  }

  logout() {
    return this.request('/auth/logout', { method: 'POST' });
  }

  getMe() {
    return this.request<User>('/auth/me');
  }

  getDesktopReleases() { return this.request<DesktopCatalog>('/desktop/manage/releases'); }
  createDesktopRelease(version: string, notes: string) {
    return this.request<{ id: string }>('/desktop/manage/releases', { method: 'POST', body: JSON.stringify({ version, notes }) });
  }
  updateDesktopRelease(id: string, body: { notes?: string; action?: 'publish' | 'unpublish' | 'latest' }) {
    return this.request(`/desktop/manage/releases/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  uploadDesktopRelease(id: string, kind: DesktopPackageKind, file: File) {
    const body = new FormData(); body.append('file', file);
    return this.request(`/desktop/manage/releases/${encodeURIComponent(id)}/files/${kind}`, { method: 'POST', body });
  }
  removeDesktopReleaseFile(id: string, kind: DesktopPackageKind) {
    return this.request(`/desktop/manage/releases/${encodeURIComponent(id)}/files/${kind}`, { method: 'DELETE' });
  }
  deleteDesktopRelease(id: string) {
    return this.request(`/desktop/manage/releases/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  getDashboardMetrics(params?: {
    adminIds?: string[];
    bidderIds?: string[];
    statuses?: string[];
    startDate?: string;
    endDate?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.adminIds?.length) qs.set('adminIds', params.adminIds.join(','));
    if (params?.bidderIds?.length) qs.set('bidderIds', params.bidderIds.join(','));
    if (params?.statuses?.length) qs.set('statuses', params.statuses.join(','));
    if (params?.startDate) qs.set('startDate', params.startDate);
    if (params?.endDate) qs.set('endDate', params.endDate);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{
      kpis: {
        total: number;
        applied: number;
        readyToApply: number;
        interviews: number;
        offers: number;
        warnings: number;
      };
      trend: Array<Record<string, string | number> & { date: string }>;
      recentGenerations: { id: string; jobTitle: string; company: string; creator: string; completedAt: string }[];
      byAdmin?: { adminId: string; name: string; total: number; interviews: number; offers: number; bidderCount: number }[];
      byBidder?: { bidderId: string; name: string; adminName: string; total: number; interviews: number; offers: number }[];
      filterOptions?: {
        admins: { id: string; name: string }[];
        bidders: { id: string; name: string; adminId: string | null }[];
      };
    }>(`/dashboard/metrics${query}`);
  }

  getApplications(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request<unknown[]>(`/applications${qs}`);
  }

  getApplication(id: string) {
    return this.request<Record<string, unknown>>(`/applications/${id}`);
  }

  createApplication(data: Record<string, unknown>) {
    return this.request('/applications', { method: 'POST', body: JSON.stringify(data) });
  }

  getApplicationOptions() {
    return this.request<{
      locations: ApplicationOption[];
      sources: ApplicationOption[];
    }>('/application-options');
  }

  createApplicationOption(data: { type: 'LOCATION' | 'SOURCE'; value: string; isDefault?: boolean }) {
    return this.request<ApplicationOption>('/application-options', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateApplicationOption(id: string, data: { value?: string; isDefault?: boolean }) {
    return this.request<ApplicationOption>(`/application-options/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteApplicationOption(id: string) {
    return this.request<{ ok: boolean }>(`/application-options/${id}`, { method: 'DELETE' });
  }

  updateApplication(
    id: string,
    data: {
      profileId?: string;
      jobTitle?: string;
      company?: string;
      location?: string;
      workArrangement?: string;
      source?: string;
      jobUrl?: string | null;
      jobDescription?: string;
    },
  ) {
    return this.request(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteApplication(id: string) {
    return this.request(`/applications/${id}`, { method: 'DELETE' });
  }

  updateApplicationStatus(id: string, status: string, note?: string) {
    return this.request(`/applications/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, note }) });
  }

  addApplicationNote(id: string, content: string) {
    return this.request(`/applications/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) });
  }

  getProfiles() {
    return this.request<unknown[]>('/profiles');
  }

  getProfile(id: string) {
    return this.request<Record<string, unknown>>(`/profiles/${id}`);
  }

  createProfile(data: Record<string, unknown>) {
    return this.request('/profiles', { method: 'POST', body: JSON.stringify(data) });
  }

  updateProfile(id: string, data: Record<string, unknown>) {
    return this.request(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  archiveProfile(id: string) {
    return this.request(`/profiles/${id}/archive`, { method: 'PATCH' });
  }

  getAssignedProfiles() {
    return this.request<unknown[]>('/profiles/assigned');
  }

  getDefaultProfile() {
    return this.request<unknown>('/profiles/default');
  }

  setDefaultProfile(id: string) {
    return this.request<{ success: boolean; profileId: string; isDefault: boolean }>(
      `/profiles/${id}/set-default`,
      { method: 'PATCH' },
    );
  }

  getUsers() {
    return this.request<unknown[]>('/users');
  }

  createUser(data: {
    email: string;
    password?: string;
    firstName: string;
    lastName: string;
    role?: string;
    managedByAdminId?: string;
  }) {
    return this.request('/users', { method: 'POST', body: JSON.stringify(data) });
  }

  getAdmins() {
    return this.request<{ id: string; firstName: string; lastName: string; email: string; status: string }[]>(
      '/users/admins',
    );
  }

  updateUser(
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      resetPassword?: boolean;
    },
  ) {
    return this.request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  deleteUser(id: string) {
    return this.request(`/users/${id}`, { method: 'DELETE' });
  }

  updateUserManagedBy(id: string, managedByAdminId: string | null) {
    return this.request(`/users/${id}/managed-by`, {
      method: 'PATCH',
      body: JSON.stringify({ managedByAdminId }),
    });
  }

  updateUserAssignments(id: string, assignments: { profileId: string; isDefault?: boolean }[]) {
    return this.request(`/users/${id}/assignments`, { method: 'PATCH', body: JSON.stringify({ assignments }) });
  }

  updateUserTemplateAssignments(
    id: string,
    assignments: { templateVersionId: string; isDefault?: boolean }[],
  ) {
    return this.request(`/users/${id}/template-assignments`, {
      method: 'PATCH',
      body: JSON.stringify({ assignments }),
    });
  }

  updateUserStatus(id: string, status: string) {
    return this.request(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }

  updateUserPermissions(
    id: string,
    perms: {
      canCreateApplications?: boolean;
      canGenerateResumes?: boolean;
      canDownloadDocuments?: boolean;
    },
  ) {
    return this.request(`/users/${id}/permissions`, { method: 'PATCH', body: JSON.stringify(perms) });
  }

  updateUserPromptAssignment(
    id: string,
    data: { useMasterPrompt: boolean; content?: string },
  ) {
    return this.request(`/users/${id}/prompt-assignment`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  updateUserPromptAssignments(
    id: string,
    assignments: { promptVersionId: string; isDefault?: boolean }[],
  ) {
    return this.request(`/users/${id}/prompt-assignments`, {
      method: 'PATCH',
      body: JSON.stringify({ assignments }),
    });
  }

  getTemplates() {
    return this.request<unknown[]>('/templates');
  }

  getTemplate(id: string) {
    return this.request<Record<string, unknown>>(`/templates/${id}`);
  }

  createTemplate(data: { name: string; preset?: string; configJson?: object }) {
    return this.request<Record<string, unknown>>('/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateTemplate(id: string, data: Record<string, unknown>) {
    return this.request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  cloneTemplate(id: string) {
    return this.request<Record<string, unknown>>(`/templates/${id}/clone`, { method: 'POST' });
  }

  publishTemplate(id: string) {
    return this.request<Record<string, unknown>>(`/templates/${id}/publish`, { method: 'PATCH' });
  }

  setDefaultTemplate(id: string) {
    return this.request<{ success: boolean; templateId: string; isDefault: boolean }>(
      `/templates/${id}/set-default`,
      { method: 'PATCH' },
    );
  }

  archiveTemplate(id: string) {
    return this.request<Record<string, unknown>>(`/templates/${id}/archive`, { method: 'PATCH' });
  }

  getTemplatePreview(id: string) {
    return this.request<{ html: string }>(`/templates/${id}/preview`);
  }

  previewTemplateDraft(id: string, configJson: object) {
    return this.request<{ html: string }>(`/templates/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ configJson }),
    });
  }

  previewTemplateConfig(configJson: object) {
    return this.request<{ html: string }>('/templates/preview', {
      method: 'POST',
      body: JSON.stringify({ configJson }),
    });
  }

  previewGenerationPrompt(applicationId: string) {
    return this.request<{
      usedDefault: boolean;
      promptName: string;
      profileName: string;
    }>(`/applications/${applicationId}/generation-prompt`);
  }

  startGeneration(applicationId: string, templateId?: string) {
    return this.request(`/applications/${applicationId}/generations`, {
      method: 'POST',
      body: JSON.stringify({ templateId }),
    });
  }

  getManualGenerationPrompt(applicationId: string, templateId?: string) {
    const query = templateId ? `?templateId=${encodeURIComponent(templateId)}` : '';
    return this.request<ManualGenerationPrompt>(`/applications/${applicationId}/manual-generation-prompt${query}`);
  }

  importManualGeneration(applicationId: string, data: {
    responseJson: string;
    coverLetterResponseJson?: string;
    contextHash: string;
    templateId: string;
    idempotencyKey: string;
  }) {
    return this.request<{ id: string; status: string }>(`/applications/${applicationId}/generations/manual`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getGenerations(applicationId: string) {
    return this.request<unknown[]>(`/applications/${applicationId}/generations`);
  }

  getGeneration(id: string) {
    return this.request<Record<string, unknown>>(`/generations/${id}`);
  }

  getGenerationPreview(id: string) {
    return this.request<GenerationDocumentPreview>(`/generations/${id}/preview`);
  }

  previewDocumentEdits(id: string, data: DocumentEdits) {
    return this.request<GenerationDocumentPreview>(`/generations/${id}/draft-preview`, { method: 'POST', body: JSON.stringify(data) });
  }

  saveDocumentEdits(id: string, data: DocumentEdits) {
    return this.request<{ generation: { id: string; version: number; status: string; structuredOutputJson: ResumeDocument }; preview: GenerationDocumentPreview }>(`/generations/${id}/edits`, { method: 'POST', body: JSON.stringify(data) });
  }

  updateDocumentDisplay(data: { showJobTitle: boolean }) {
    return this.request<{ showJobTitle: boolean }>('/settings/document-display', { method: 'PATCH', body: JSON.stringify(data) });
  }

  async createResumePublicLink(id: string) {
    const link = await this.request<{ path: string; expiresAt: string }>(`/generations/${id}/public-link`, { method: 'POST' });
    const desktop = desktopBridge();
    const origin = desktop ? new URL((await desktop.bootstrap()).settings.server).origin : window.location.origin;
    return { ...link, url: new URL(link.path, origin).href };
  }

  revokeResumePublicLink(id: string) {
    return this.request(`/generations/${id}/public-link`, { method: 'DELETE' });
  }

  getProfileGenerationPreference(id: string) {
    return this.request<{ resumePromptId: string | null; coverLetterPromptId: string | null }>(`/profiles/${id}/generation-preference`);
  }

  saveProfileGenerationPreference(id: string, data: { resumePromptId: string | null; coverLetterPromptId: string | null }) {
    return this.request(`/profiles/${id}/generation-preference`, { method: 'PUT', body: JSON.stringify(data) });
  }

  getGenerationAnswers(generationId: string) {
    return this.request<{
      primed: boolean;
      ack: string | null;
      items: { question: string; answer: string }[];
    }>(`/generations/${generationId}/answers`);
  }

  primeGenerationAnswers(generationId: string) {
    return this.request<{
      primed: boolean;
      ack: string | null;
      items: { question: string; answer: string }[];
    }>(`/generations/${generationId}/answers/prompt`, { method: 'POST' });
  }

  askGenerationQuestion(generationId: string, question: string) {
    return this.request<{
      primed: boolean;
      ack: string | null;
      items: { question: string; answer: string }[];
    }>(`/generations/${generationId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  }

  exportGenerationFile(
    generationId: string,
    file: { kind: 'RESUME' | 'COVER_LETTER'; type: 'PDF' | 'DOCX' },
  ) {
    return this.request<{ id: string; filename: string }>(`/generations/${generationId}/export`, {
      method: 'POST',
      body: JSON.stringify(file),
    });
  }

  getDocumentUrl(fileId: string) {
    return `${API_URL}/documents/${fileId}/download`;
  }

  async downloadDocument(fileId: string, filename: string) {
    const desktop = desktopBridge();
    if (desktop) return desktop.download(fileId, filename);
    const res = await fetch(this.getDocumentUrl(fileId), {
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
    });
    if (!res.ok) throw new Error('Download failed');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename(res, filename);
    a.click();
    URL.revokeObjectURL(url);
  }

  async getPublicDesktopRelease(signal?: AbortSignal) {
    const desktop = desktopBridge();
    if (desktop) return desktop.publicRequest('/desktop/release');
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/backend'}/desktop/release`, { signal, credentials: 'omit', cache: 'no-store', headers: { 'ngrok-skip-browser-warning': 'true' } });
    if (!res.ok) throw new Error('Download unavailable');
    return res.json();
  }

  getWarningRules() {
    return this.request<unknown[]>('/settings/warning-rules');
  }

  createWarningRule(data: {
    category: string;
    pattern: string;
    severity: string;
    behavior: string;
  }) {
    return this.request('/settings/warning-rules', { method: 'POST', body: JSON.stringify(data) });
  }

  updateWarningRule(id: string, data: Record<string, unknown>) {
    return this.request(`/settings/warning-rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  getPromptLibrary(scope: 'manage' | 'assign' = 'manage') {
    return this.request<
      {
        id: string;
        name: string;
        content: string;
        version: number;
        isPublished: boolean;
        isInitial: boolean;
        experienceTitleMode: ExperienceTitleMode;
        ownerId: string | null;
        owner?: { id: string; firstName: string; lastName: string; role: string } | null;
      }[]
    >(`/settings/prompt-library?scope=${scope}`);
  }

  createLibraryPrompt(data: { name: string; content: string; experienceTitleMode?: ExperienceTitleMode; documentKind?: DocumentKind }) {
    return this.request<PrivatePrompt>('/settings/prompt-library', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateLibraryPrompt(id: string, data: { name?: string; content?: string; experienceTitleMode?: ExperienceTitleMode; documentKind?: DocumentKind }) {
    return this.request<PrivatePrompt>(`/settings/prompt-library/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteLibraryPrompt(id: string) {
    return this.request<{ success: boolean; id: string }>(`/settings/prompt-library/${id}`, {
      method: 'DELETE',
    });
  }

  getPromptMode() {
    return this.request<{ mode: 'user' | 'profile' | 'separate' }>('/settings/prompt-mode');
  }

  getGenerationWorkflow() {
    return this.request<GenerationWorkflow>('/settings/generation-workflow');
  }

  updatePromptMode(mode: 'user' | 'profile' | 'separate') {
    return this.request<{ mode: 'user' | 'profile' | 'separate' }>('/settings/prompt-mode', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    });
  }

  getProfilePromptAssignments(profileId: string) {
    return this.request<{
      mode: 'user' | 'profile' | 'separate';
      profile: { id: string; firstName: string; lastName: string; promptVersionId?: string | null };
      prompts: {
        id: string;
        name: string;
        isInitial: boolean;
        ownerId: string | null;
        ownerName: string | null;
      }[];
      bidders: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        promptVersionId: string | null;
      }[];
    }>(`/profiles/${profileId}/prompt-assignments`);
  }

  updateProfilePromptAssignments(
    profileId: string,
    data: {
      promptVersionId?: string | null;
      assignments?: { userId: string; promptVersionId: string | null }[];
    },
  ) {
    return this.request(`/profiles/${profileId}/prompt-assignments`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  getPrompts() {
    return this.request<unknown[]>('/settings/prompts');
  }

  createPrompt(content: string) {
    return this.request('/settings/prompts', { method: 'POST', body: JSON.stringify({ content }) });
  }

  updatePrompt(id: string, content: string) {
    return this.request(`/settings/prompts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  deletePrompt(id: string) {
    return this.request<{ success: boolean; id: string }>(`/settings/prompts/${id}`, {
      method: 'DELETE',
    });
  }

  publishPrompt(id: string) {
    return this.request(`/settings/prompts/${id}/publish`, { method: 'POST' });
  }

  getMyPrompt() {
    return this.request<{
      role: 'MASTER' | 'ADMIN' | 'BIDDER';
      useMasterPrompt: boolean | null;
      promptSource?: 'initial' | 'custom' | null;
      assignmentMode?: 'user' | 'profile' | 'separate';
      masterPrompt: { id: string; name?: string; content: string; version: number; isPublished: boolean } | null;
      myPrompt: { id: string; name?: string; content: string; version: number; isPublished: boolean } | null;
      myPrompts?: { id: string; name: string; content: string; version?: number; isPublished?: boolean }[];
      assignedPrompts?: { id: string; name: string; content?: string; isDefault: boolean }[];
      profilePrompts?: { profileName: string; promptName: string }[];
      selectedPromptId?: string | null;
      effectivePrompt: { id: string; name?: string; content: string; version: number; isPublished: boolean } | null;
    }>('/settings/my-prompt');
  }

  updateMyPrompt(data: {
    mode?: 'user' | 'profile' | 'separate';
    content?: string;
    resetToDefault?: boolean;
  }) {
    return this.request<{
      role: 'MASTER' | 'ADMIN' | 'BIDDER';
      useMasterPrompt: boolean | null;
      promptSource?: 'initial' | 'custom' | null;
      assignmentMode?: 'user' | 'profile' | 'separate';
      masterPrompt: { id: string; name?: string; content: string; version: number; isPublished: boolean } | null;
      myPrompt: { id: string; name?: string; content: string; version: number; isPublished: boolean } | null;
      myPrompts?: { id: string; name: string; content: string }[];
      selectedPromptId?: string | null;
      effectivePrompt: { id: string; name?: string; content: string; version: number; isPublished: boolean } | null;
    }>('/settings/my-prompt', { method: 'PATCH', body: JSON.stringify(data) });
  }

  getAnswerPrompt() {
    return this.request<{ prompt: string }>('/settings/answer-prompt');
  }

  updateAnswerPrompt(prompt: string) {
    return this.request<{ prompt: string }>('/settings/answer-prompt', {
      method: 'PATCH',
      body: JSON.stringify({ prompt }),
    });
  }

  getAiSettings() {
    return this.request<{ hasApiKey: boolean; model: string }>('/settings/ai');
  }

  updateAiSettings(data: { apiKey?: string; model?: string }) {
    return this.request<{ hasApiKey: boolean; model: string }>('/settings/ai', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  changePassword(data: { currentPassword: string; newPassword: string; confirmPassword: string }) {
    return this.request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  getAuditLog() {
    return this.request<unknown[]>('/audit');
  }

  getJobPool() {
    return this.request<{ enabled: boolean; message: string; jobs: unknown[]; total: number }>('/job-pool');
  }
}

export const api = new ApiClient();
