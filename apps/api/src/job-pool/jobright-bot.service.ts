import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { JobrightJob, JobrightSettings, JobrightStatus, jobrightAfterStart, jobrightLinkExclusion,
  jobrightOriginalUrl, jobrightSearchUrl, normalizeJobrightRules } from '@anchorproposal/shared';
import { AuthUser } from '../common/types/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { JobPoolService } from './job-pool.service';

const KEY = 'jobright_browser_bot:v1', LEASE_MS = 90_000;
type State = Omit<JobrightStatus, 'connected' | 'keyConfigured'> & { keyHash: string | null; keyOwnerId: string | null;
  instanceId: string | null; resumeAfterLogin: boolean; workerScanned: number; workerSkipped: number };
const defaults = (): State => ({ settings: { blockedDomains: [], blockedWords: [], intervalMinutes: 5, maxJobsPerScan: 40 },
  desired: 'stopped', runId: null, startedAt: null, authenticated: false, keyHash: null, keyOwnerId: null, instanceId: null,
  resumeAfterLogin: false, workerStatus: 'stopped', browserMode: 'closed', heartbeatAt: null, lastScanAt: null, lastError: null,
  loginFinishRequested: false, browserVisible: false, checkpoint: null, counts: { scanned: 0, imported: 0, duplicates: 0, skipped: 0 }, workerScanned: 0, workerSkipped: 0, recent: [] });
const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const safeMessage = (value: unknown) => typeof value === 'string' ? value.replace(/Bearer\s+\S+/gi, 'Bearer [hidden]').replace(/https?:\/\/\S+/g, text => {
  try { const url = new URL(text); return url.origin + url.pathname; } catch { return '[URL]'; }
}).slice(0, 600) : '';

@Injectable()
export class JobrightBotService {
  constructor(private prisma: PrismaService, private pool: JobPoolService) {}
  private master(user: AuthUser) { if (user.role !== 'MASTER') throw new ForbiddenException('Only Master can manage the Jobright bot.'); }
  private parse(value?: string): State {
    const state = value ? { ...defaults(), ...JSON.parse(value) } as State : defaults();
    // Upgrade existing saved settings without retaining the removed URL input.
    const { blockedDomains, blockedWords, intervalMinutes, maxJobsPerScan } = { ...defaults().settings, ...state.settings };
    state.settings = { blockedDomains, blockedWords, intervalMinutes, maxJobsPerScan }; return state;
  }
  private async read() { const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } }); return this.parse(row?.value); }
  private note(state: State, message: string) { state.recent = [{ at: new Date().toISOString(), message: safeMessage(message) }, ...state.recent].slice(0, 15); }
  private async mutate<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(defaults()) }, update: {} });
      const [row] = await tx.$queryRaw<{ value: string }[]>`SELECT value FROM system_settings WHERE key = ${KEY} FOR UPDATE`;
      const state = this.parse(row.value), result = await fn(state);
      await tx.systemSetting.update({ where: { key: KEY }, data: { value: JSON.stringify(state) } }); return result;
    }, { timeout: 30000 });
  }
  private publicState(state: State): JobrightStatus {
    const { keyHash, keyOwnerId, instanceId, resumeAfterLogin, workerScanned, workerSkipped, ...view } = state;
    return { ...view, keyConfigured: !!keyHash, connected: !!instanceId && !!state.heartbeatAt && Date.now() - Date.parse(state.heartbeatAt) < LEASE_MS };
  }
  async status(user: AuthUser) { this.master(user); return this.publicState(await this.read()); }
  async settings(user: AuthUser, body: Record<string, unknown>) {
    this.master(user); let settings: JobrightSettings;
    try {
      if (!Number.isInteger(body.intervalMinutes) || Number(body.intervalMinutes) < 2 || Number(body.intervalMinutes) > 60) throw Error('Choose an interval from 2 to 60 minutes.');
      if (!Number.isInteger(body.maxJobsPerScan) || Number(body.maxJobsPerScan) < 1 || Number(body.maxJobsPerScan) > 100) throw Error('Choose 1–100 jobs per scan.');
      settings = { ...normalizeJobrightRules(body.blockedDomains, body.blockedWords), intervalMinutes: Number(body.intervalMinutes), maxJobsPerScan: Number(body.maxJobsPerScan) };
    } catch (error) { throw new BadRequestException((error as Error).message); }
    return this.mutate(state => { state.settings = settings; this.note(state, 'Jobright exclusions and scan settings saved.'); return this.publicState(state); });
  }
  async rotateKey(user: AuthUser) {
    this.master(user); const key = 'jrbot_' + randomBytes(32).toString('hex');
    const status = await this.mutate(state => { state.keyHash = hash(key); state.keyOwnerId = user.id; state.instanceId = null; state.heartbeatAt = null;
      this.note(state, 'Worker key generated. Previous worker keys were revoked.'); return this.publicState(state); });
    return { key, status };
  }
  async command(user: AuthUser, action: unknown) {
    this.master(user);
    if (!['start', 'stop', 'login', 'finish-login', 'show-browser', 'hide-browser'].includes(action as string)) throw new BadRequestException('Choose a supported bot action.');
    return this.mutate(state => {
      if (!state.keyHash) throw new BadRequestException('Generate and configure the worker key first.');
      if (action === 'start') {
        if (state.desired === 'running' || state.desired === 'login' && state.resumeAfterLogin) return this.publicState(state);
        state.runId = randomUUID(); state.startedAt = new Date().toISOString(); state.desired = 'running'; state.lastError = null;
        state.checkpoint = null;
        state.counts = { scanned: 0, imported: 0, duplicates: 0, skipped: 0 }; state.workerScanned = 0; state.workerSkipped = 0;
        this.note(state, 'Watching only jobs posted after this start time.');
      } else if (action === 'login') {
        if (state.desired !== 'login') state.resumeAfterLogin = state.desired === 'running';
        state.desired = 'login'; state.browserVisible = true; state.loginFinishRequested = false; state.lastError = null; this.note(state, 'Opening sign-in on the Ubuntu desktop.');
      } else if (action === 'show-browser') {
        state.browserVisible = true; this.note(state, 'Showing Chrome on Ubuntu. Collection pauses while you change filters.');
      } else if (action === 'hide-browser') {
        state.browserVisible = false; state.loginFinishRequested = true;
        this.note(state, 'Hiding Chrome. The same search page and filters will be used for collection.');
      } else if (action === 'finish-login') {
        if (state.desired !== 'login') throw new BadRequestException('Open the login window first.');
        state.loginFinishRequested = true; state.browserVisible = false;
      } else { state.desired = 'stopped'; state.resumeAfterLogin = false; state.loginFinishRequested = false; this.note(state, 'Bot stopped.'); }
      return this.publicState(state);
    });
  }
  async authenticate(authorization: unknown): Promise<string> {
    const key = typeof authorization === 'string' ? /^Bearer (jrbot_[a-f0-9]{64})$/.exec(authorization)?.[1] : null;
    if (!key) throw new UnauthorizedException('Invalid worker key');
    const digest = hash(key), state = await this.read();
    if (!state.keyHash || !/^[a-f0-9]{64}$/.test(state.keyHash) || !timingSafeEqual(Buffer.from(digest), Buffer.from(state.keyHash))) throw new UnauthorizedException('Invalid worker key');
    const owner = await this.prisma.user.findFirst({ where: { id: state.keyOwnerId!, role: 'MASTER', status: 'ACTIVE' }, select: { id: true } });
    if (!owner) throw new UnauthorizedException('Worker key owner is inactive'); return digest;
  }
  private lease(state: State, digest: string, instanceId: unknown, claim = false) {
    if (digest !== state.keyHash) throw new UnauthorizedException('Worker key was revoked');
    if (typeof instanceId !== 'string' || !/^[a-f0-9-]{36}$/.test(instanceId)) throw new BadRequestException('Invalid worker instance');
    if (state.instanceId !== instanceId) {
      if (!claim || (state.instanceId && state.heartbeatAt && Date.now() - Date.parse(state.heartbeatAt) < LEASE_MS)) throw new ConflictException('Another worker is active, or this worker lease expired.');
      state.instanceId = instanceId; state.workerScanned = 0; state.workerSkipped = 0;
    }
    state.heartbeatAt = new Date().toISOString();
  }
  async workerConfig(digest: string, instanceId: unknown) {
    return this.mutate(state => { this.lease(state, digest, instanceId, true); return { settings: state.settings, desired: state.desired, runId: state.runId,
      startedAt: state.startedAt, authenticated: state.authenticated, loginFinishRequested: state.loginFinishRequested,
      browserVisible: state.browserVisible, checkpoint: state.checkpoint, counts: state.counts }; });
  }
  async heartbeat(digest: string, body: Record<string, unknown>) {
    return this.mutate(state => {
      this.lease(state, digest, body.instanceId);
      if (['starting', 'ready', 'watching', 'scanning', 'browser_open', 'login_required', 'blocked', 'stopped', 'error'].includes(body.status as string)) state.workerStatus = body.status as string;
      if (['visible', 'hidden', 'closed'].includes(body.browserMode as string)) state.browserMode = body.browserMode as string;
      if (typeof body.authenticated === 'boolean') state.authenticated = body.authenticated;
      if (body.error !== undefined) state.lastError = safeMessage(body.error) || null;
      if (body.scanCompleted === true && body.runId === state.runId && state.desired === 'running' && !state.browserVisible) {
        state.lastScanAt = new Date().toISOString();
        if (body.checkpoint && typeof body.checkpoint === 'object') {
          const mark = body.checkpoint as Record<string, unknown>;
          if (typeof mark.externalId !== 'string' || !/^[\w-]{1,100}$/.test(mark.externalId) ||
            mark.sourceUrl !== 'https://jobright.ai/jobs/info/' + mark.externalId || !jobrightAfterStart(mark.publishedAt, state.startedAt)) throw new BadRequestException('Invalid job checkpoint.');
          if (!state.checkpoint || Date.parse(mark.publishedAt as string) >= Date.parse(state.checkpoint.publishedAt)) state.checkpoint = {
            externalId: mark.externalId, sourceUrl: mark.sourceUrl as string, publishedAt: mark.publishedAt as string,
            title: safeMessage(mark.title).slice(0, 250), company: safeMessage(mark.company).slice(0, 250),
          };
        }
      }
      if (body.runId === state.runId) for (const [key, stored] of [['scanned', 'workerScanned'], ['skipped', 'workerSkipped']] as const) {
        const count = Number(body[key]); if (Number.isSafeInteger(count) && count >= 0 && count <= 10_000_000) {
          state.counts[key] += Math.max(0, count - state[stored]); state[stored] = Math.max(count, state[stored]);
        }
      }
      if (!state.browserVisible && body.loginCompleted === true && body.authenticated === true) {
        if (state.desired === 'login') state.desired = state.resumeAfterLogin && !!state.runId ? 'running' : 'stopped';
        state.resumeAfterLogin = false;
        state.loginFinishRequested = false; state.lastError = null; this.note(state, 'Login session saved. Chrome will continue hidden.');
      }
      if (body.release === true) { state.instanceId = null; state.workerStatus = 'stopped'; state.browserMode = 'closed'; }
      return { desired: state.desired, browserVisible: state.browserVisible, runId: state.runId };
    });
  }
  async ingest(digest: string, body: Record<string, unknown>) {
    if (!Array.isArray(body.jobs) || !body.jobs.length || body.jobs.length > 10) throw new BadRequestException('Send 1–10 jobs per request.');
    return this.mutate(async state => {
      this.lease(state, digest, body.instanceId);
      if (state.desired !== 'running' || state.browserVisible || !state.startedAt || !state.runId || body.runId !== state.runId) throw new ConflictException('This bot run is paused or no longer watching.');
      const results: { externalId?: string; status: string; reason?: string; id?: string }[] = [];
      for (const value of body.jobs as unknown[]) {
        const job = value as JobrightJob;
        let reason = '';
        if (!job || typeof job !== 'object' || typeof job.externalId !== 'string' || !/^[\w-]{1,100}$/.test(job.externalId)) reason = 'Invalid source job';
        else if (jobrightSearchUrl(job.sourceUrl)?.split('?')[0] !== 'https://jobright.ai/jobs/info/' + job.externalId) reason = 'Invalid Jobright source page';
        else if (!jobrightAfterStart(job.publishedAt, state.startedAt)) reason = 'Job was not posted after this bot start, or its posting time is unknown';
        const original = jobrightOriginalUrl(job?.originalUrl);
        if (!reason) reason = original ? jobrightLinkExclusion(original, state.settings) || '' : 'Original employer job URL is unavailable';
        const result = reason ? { status: 'skipped', reason } : await this.pool.importJobrightJob({ ...job, originalUrl: original! }, state.startedAt);
        if (result.status === 'imported') state.counts.imported++; else if (result.status === 'duplicate') state.counts.duplicates++; else state.counts.skipped++;
        results.push({ externalId: typeof job?.externalId === 'string' ? job.externalId.slice(0, 100) : undefined, ...result });
      }
      const added = results.filter(row => row.status === 'imported').length;
      if (added) this.note(state, `Imported ${added} new Jobright jobs with original links.`);
      return { results };
    });
  }
}
