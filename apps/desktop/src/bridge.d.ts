type DesktopSettings = { server: string; hotkey: string; alwaysOnTop: boolean; launchAtLogin: boolean; notifications: boolean };
type Job = { id: string; applicationId: string; generationId?: string; title: string; stage: string; startedAt: number; finishedAt?: number; characters: number; message?: string };
interface Window {
  anchor: {
    bootstrap(): Promise<{ settings: DesktopSettings; shortcutError: string; job: Job | null; version: string; authenticated: boolean }>;
    auth(action: string, data: Record<string, unknown>): Promise<any>;
    logout(): Promise<void>;
    request(route: string, method?: string, body?: unknown): Promise<any>;
    settings(value: Partial<DesktopSettings>): Promise<DesktopSettings>;
    window(action: 'close' | 'hide' | 'compact' | 'expand' | 'quit' | 'new' | 'workspace' | 'minimize' | 'maximize'): Promise<void>;
    openRoute(path: string): Promise<void>;
    external(url: string): Promise<void>;
    ready(): Promise<void>;
    publicRequest(route: string): Promise<any>;
    upload(route: string, file: { name: string; type: string; bytes: ArrayBuffer }): Promise<any>;
    download(id: string, filename?: string): Promise<{ cancelled?: boolean; filename?: string }>;
    paste(): Promise<string>; copy(text: string): Promise<void>;
    generate(input: { applicationId: string; templateId?: string; title: string }): Promise<Job>;
    cancel(): Promise<void>;
    export(id: string, type: 'PDF' | 'DOCX', kind?: 'RESUME' | 'COVER_LETTER'): Promise<{ cancelled?: boolean; filename?: string }>;
    onEvent(callback: (event: any) => void): () => void;
  };
}
