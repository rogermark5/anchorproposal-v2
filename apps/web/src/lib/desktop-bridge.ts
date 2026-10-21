export interface DesktopBridge {
  bootstrap(): Promise<{ settings: { server: string } }>;
  request(route: string, method?: string, body?: unknown): Promise<any>;
  download(id: string, filename?: string): Promise<unknown>;
  upload(route: string, file: { name: string; type: string; bytes: ArrayBuffer }): Promise<any>;
  publicRequest(route: string): Promise<any>;
  poolDefaults?(): Promise<{country:string;days:string;applied:string}>;
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { anchor?: DesktopBridge }).anchor;
}
