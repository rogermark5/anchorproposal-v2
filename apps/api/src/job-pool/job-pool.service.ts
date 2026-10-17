import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsService } from '../applications/applications.service';
import { AuthUser } from '../common/types/auth.types';
import { normalizedJobUrl } from '../applications/job-url';
import { fetchJobPage, FeedError, isUsLocation, JOB_PROVIDERS, jobDate, MAX_IMPORT_PAGES, MIN_SYNC_MS, plainText, publicJobUrl } from './job-providers';
import { isSoftwareJob } from './software-jobs';
import { FREEHIRE_MAX_PAGES, FREEHIRE_SOURCES } from './freehire-feed';
import { poolJobIdentity } from './job-identity';
import { REMOTEJOBS_CATEGORIES, REMOTEJOBS_MAX_PAGES, postingShingles, samePostingContent, samePostingGroup } from './remotejobs-feed';

const SETTINGS_KEY = 'job_pool_settings';
const DAY = 86400_000;
const AGGREGATORS = ['freehire', 'freehire-global', 'ocean', 'remotejobs'];
type PoolSettings = { enabled: boolean; intervalHours: number };

@Injectable()
export class JobPoolService implements OnApplicationBootstrap, OnModuleDestroy {
  private logger = new Logger(JobPoolService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private boardRunning?: Promise<void>;
  private feedRunning?: Promise<void>;
  private stopping = false;
  constructor(private prisma: PrismaService, private applications: ApplicationsService) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => { void this.startWorker(); }, 60_000); this.timer.unref();
    void this.startWorker();
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
  private master(user: AuthUser) { if (user?.role !== UserRole.MASTER) throw new ForbiddenException('Only Master can manage the Job Pool.'); }
  private configured(provider: string) { return provider !== 'usajobs' || !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_EMAIL); }
  private available(now = new Date()): Prisma.JobPoolJobWhereInput {
    return { hidden: false, isActive: true, isSoftware: true, workArrangement: 'REMOTE', lastSeenAt: { gte: new Date(now.getTime() - 30 * DAY) }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  }
  private async settings(): Promise<PoolSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
    try { const data = JSON.parse(row?.value || '{}'); return { enabled: data.enabled === true, intervalHours: [1, 6, 12, 24].includes(data.intervalHours) ? data.intervalHours : 6 }; }
    catch { return { enabled: false, intervalHours: 6 }; }
  }
  async manage(user: AuthUser) {
    this.master(user);
    const [settings, sources] = await Promise.all([this.settings(), this.prisma.jobPoolSource.findMany({ orderBy: [{ provider: 'asc' }, { name: 'asc' }] })]);
    return { settings, providers: JOB_PROVIDERS.map(provider => ({ ...provider, configured: this.configured(provider.id) })),
      sources: sources.map(({ lockedUntil, ...source }) => ({ ...source, running: !!lockedUntil && lockedUntil > new Date(), configured: this.configured(source.provider),
        nextManualSyncAt: source.lastAttemptAt ? new Date(source.lastAttemptAt.getTime() + MIN_SYNC_MS) : null })) };
  }
  async updateSettings(user: AuthUser, body: Record<string, unknown>) {
    this.master(user); const settings = await this.settings();
    if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw new BadRequestException('Choose whether automatic imports are enabled.'); settings.enabled = body.enabled; }
    if (body.intervalHours !== undefined) { if (![1, 6, 12, 24].includes(body.intervalHours as number)) throw new BadRequestException('Choose an import interval of 1, 6, 12 or 24 hours.'); settings.intervalHours = body.intervalHours as number; }
    await this.prisma.systemSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: JSON.stringify(settings) }, update: { value: JSON.stringify(settings) } });
    // A shorter interval should take effect for previously scheduled sources too.
    if (settings.enabled) {
      const sources = await this.prisma.jobPoolSource.findMany({ where: { enabled: true } });
      for (const source of sources) {
        const next = new Date((source.lastAttemptAt?.getTime() || 0) + settings.intervalHours * MIN_SYNC_MS);
        if (!source.lastError && next < source.nextSyncAt) await this.prisma.jobPoolSource.update({ where: { id: source.id }, data: { nextSyncAt: next } });
      }
      void this.startWorker();
    }
    return settings;
  }
  async addSource(user: AuthUser, body: Record<string, unknown>) {
    this.master(user);
    const provider = JOB_PROVIDERS.find(item => item.id === body.provider);
    if (!provider) throw new BadRequestException('Choose a supported free source.');
    const boardToken = provider.board && typeof body.boardToken === 'string' ? body.boardToken.trim() : '';
    if (provider.board && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(boardToken)) throw new BadRequestException('Enter the company board name only, such as airbnb, not a URL.');
    if (provider.id.startsWith('freehire') && !FREEHIRE_SOURCES.includes(boardToken as typeof FREEHIRE_SOURCES[number])) throw new BadRequestException('Choose one of the supported employer feeds.');
    if (provider.id === 'remotejobs' && !REMOTEJOBS_CATEGORIES.includes(boardToken as typeof REMOTEJOBS_CATEGORIES[number])) throw new BadRequestException('Choose a supported RemoteJobs.org software category.');
    const name = plainText(body.name, 120) || (provider.id.startsWith('freehire') ? `${boardToken} via Freehire${provider.id === 'freehire-global' ? ' · worldwide' : ''}` : provider.board ? boardToken : provider.name);
    try { return await this.prisma.jobPoolSource.create({ data: { provider: provider.id, name, boardToken } }); }
    catch (error) { if ((error as { code?: string }).code === 'P2002') throw new BadRequestException('This source is already added.'); throw error; }
  }
  async updateSource(user: AuthUser, id: string, body: Record<string, unknown>) {
    this.master(user);
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('Choose whether this source is enabled.');
    const source = await this.prisma.jobPoolSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Source not found.');
    return this.prisma.jobPoolSource.update({ where: { id }, data: { enabled: body.enabled, ...(!body.enabled ? { queued: false } : {}) } });
  }
  async sync(user: AuthUser, body: Record<string, unknown>) {
    this.master(user);
    if (body.sourceIds !== undefined && (!Array.isArray(body.sourceIds) || body.sourceIds.length > 1000 || body.sourceIds.some(id => typeof id !== 'string'))) throw new BadRequestException('Choose valid sources.');
    const now = new Date();
    const sources = await this.prisma.jobPoolSource.findMany({ where: { enabled: true, ...(body.sourceIds ? { id: { in: body.sourceIds as string[] } } : {}) } });
    const ready = sources.filter(source => this.configured(source.provider) && (!source.lastAttemptAt || source.lastAttemptAt.getTime() <= now.getTime() - MIN_SYNC_MS) && (!source.lockedUntil || source.lockedUntil <= now));
    // Never bypass Retry-After following a failed request, even for a manual sync.
    const ids = ready.filter(source => !source.lastError || source.nextSyncAt <= now).map(source => source.id);
    // A worker can claim or finish a source after the readiness query above.
    // Recheck eligibility in the write so that sync cannot requeue that source
    // during its cooldown or leave a completed import stuck as "queued".
    const result = await this.prisma.jobPoolSource.updateMany({ where: { id: { in: ids }, enabled: true, AND: [
      { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(now.getTime() - MIN_SYNC_MS) } }] },
      { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      { OR: [{ lastError: null }, { lastError: '' }, { nextSyncAt: { lte: now } }] },
    ] }, data: { queued: true, nextSyncAt: now } });
    void this.startWorker();
    return { queued: result.count, message: result.count ? `${result.count} sources queued. Jobs appear as they are imported.` : 'No sources are ready. Enable a source, configure its free key if needed, or wait for its next refresh.' };
  }
  private startWorker(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    // A rate-limited aggregate feed can take many minutes. Keep company-board
    // imports independent so newly queued boards do not wait for that feed.
    if (!this.boardRunning) this.boardRunning = this.poll('boards').catch(() => this.logger.warn('Employer-board imports will retry on the next pass.')).finally(() => { this.boardRunning = undefined; });
    if (!this.feedRunning) this.feedRunning = this.poll('feeds').catch(() => this.logger.warn('Aggregate-feed imports will retry on the next pass.')).finally(() => { this.feedRunning = undefined; });
    this.running = Promise.all([this.boardRunning, this.feedRunning]).then(() => {});
    return this.running;
  }
  private async poll(lane: 'boards' | 'feeds') {
    const settings = await this.settings(); const now = new Date();
    // Recover queued flags left by older versions after an import completed.
    // A genuine pending request is due now; a running import retains its lease.
    await this.prisma.jobPoolSource.updateMany({ where: { queued: true, lastAttemptAt: { not: null }, nextSyncAt: { gt: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, data: { queued: false } });
    const sources = await this.prisma.jobPoolSource.findMany({ where: { enabled: true, nextSyncAt: { lte: now },
      provider: lane === 'boards' ? { notIn: AGGREGATORS } : { in: AGGREGATORS },
      ...(settings.enabled ? {} : { queued: true }), OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, orderBy: { nextSyncAt: 'asc' }, take: 1000 });
    if (!sources.length) return;
    const before = await this.prisma.jobPoolJob.count({ where: this.available() });
    const stats = { checked: 0, processed: 0, retries: 0 };
    this.logger.log(`${lane === 'boards' ? 'Employer boards' : 'Aggregate feeds'}: checking ${sources.length} sources; ${before} jobs available.`);
    let index = 0;
    await Promise.all(Array.from({ length: lane === 'boards' ? 4 : 2 }, async () => {
      while (index < sources.length && !this.stopping) {
        const source = sources[index++]; if (!this.configured(source.provider)) continue;
        const started = new Date();
        const claim = await this.prisma.jobPoolSource.updateMany({ where: { id: source.id, enabled: true, nextSyncAt: { lte: started },
          AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lte: started } }] },
            { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(started.getTime() - MIN_SYNC_MS) } }] }] },
          data: { lastAttemptAt: started, lockedUntil: new Date(started.getTime() + 20 * 60_000), queued: false, nextSyncAt: new Date(started.getTime() + settings.intervalHours * MIN_SYNC_MS) } });
        if (!claim.count) continue;
        let count = 0, lastError: string | null = null, succeeded = false, delay = settings.intervalHours * MIN_SYNC_MS;
        try {
          const aliases = new Map<string, string>(), primaryJobs = new Set<string>();
          const contentMatches = new Map<string, { canonicalUrl: string; preferred: boolean }[]>();
          if (AGGREGATORS.includes(source.provider)) {
            const saved = await this.prisma.jobPoolJob.findMany({ select: { jobUrl: true, canonicalUrl: true, externalId: true, isActive: true, isSoftware: true, lastSeenAt: true,
              ...(source.provider === 'remotejobs' ? { company: true, title: true } : {}), source: { select: { provider: true, boardToken: true, enabled: true } } } });
            for (const job of saved) {
              const keys = [poolJobIdentity(job.jobUrl)];
              if (job.source?.provider === 'greenhouse') keys.push(`greenhouse:${job.source.boardToken.toLowerCase()}:${job.externalId}`);
              for (const key of keys) {
                aliases.set(key, job.canonicalUrl);
                const preferred = !AGGREGATORS.includes(job.source?.provider || 'manual') || (source.provider === 'ocean' && job.source?.provider.startsWith('freehire'));
                if (preferred && job.source?.enabled !== false && job.isActive && job.isSoftware && job.lastSeenAt.getTime() >= Date.now() - 7 * DAY) primaryJobs.add(key);
              }
              if (source.provider === 'remotejobs') {
                const group = samePostingGroup(job.company, job.title), matches = contentMatches.get(group) || [];
                matches.push({canonicalUrl: job.canonicalUrl, preferred: job.source?.provider !== 'remotejobs' && job.isActive && job.isSoftware && job.source?.enabled !== false && job.lastSeenAt.getTime() >= Date.now() - 7 * DAY});
                contentMatches.set(group, matches);
              }
            }
          }
          let cursor: string | null = null, complete = false, incomplete = false; const cursors = new Set<string>();
          for (let page = 0; page < (source.provider.startsWith('freehire') ? FREEHIRE_MAX_PAGES : source.provider === 'remotejobs' ? REMOTEJOBS_MAX_PAGES : MAX_IMPORT_PAGES) && !this.stopping; page++) {
            const current = await this.prisma.jobPoolSource.findUnique({ where: { id: source.id } });
            if (!current?.enabled) break;
            // Large feeds can span many pages. Renew our lease before each
            // bounded request so another process cannot start the same import.
            const renewed = await this.prisma.jobPoolSource.updateMany({ where: { id: source.id, lastAttemptAt: started, enabled: true },
              data: { lockedUntil: new Date(Date.now() + 20 * 60_000) } });
            if (!renewed.count) break;
            const result = await fetchJobPage(source, cursor, undefined, url => primaryJobs.has(poolJobIdentity(url)));
            for (const job of result.jobs) {
              if (this.stopping) break;
              const identity = poolJobIdentity(job.jobUrl);
              if (AGGREGATORS.includes(source.provider) && primaryJobs.has(identity)) continue;
              const group = source.provider === 'remotejobs' ? samePostingGroup(job.company, job.title) : '';
              // Load one matching description at a time. Keeping shingle sets
              // for the entire pool consumes gigabytes on a large database.
              let contentMatch: { canonicalUrl: string; preferred: boolean } | undefined;
              if (group && !aliases.has(identity)) {
                const shingles = postingShingles(job.description);
                for (const candidate of contentMatches.get(group) || []) {
                  const saved = await this.prisma.jobPoolJob.findUnique({where: {canonicalUrl: candidate.canonicalUrl}, select: {description: true}});
                  if (saved && samePostingContent(postingShingles(saved.description), shingles)) { contentMatch = candidate; break; }
                }
              }
              if (contentMatch?.preferred) continue;
              const canonicalUrl = aliases.get(identity) || contentMatch?.canonicalUrl || normalizedJobUrl(job.jobUrl)!;
              const data = { ...job, canonicalUrl, sourceId: source.id, lastSeenAt: started, isSoftware: true, isActive: !job.expiresAt || job.expiresAt > started };
              const postedAt = job.publishedAt || started;
              await this.prisma.jobPoolJob.upsert({ where: { canonicalUrl }, create: { ...data, postedAt }, update: { ...data, ...(job.publishedAt ? { postedAt } : {}) } });
              aliases.set(identity, canonicalUrl);
              if (group && !contentMatch) { const matches = contentMatches.get(group) || []; if (!matches.some(saved => saved.canonicalUrl === canonicalUrl)) matches.push({canonicalUrl, preferred: false}); contentMatches.set(group, matches); }
              count++;
            }
            incomplete ||= result.incomplete === true;
            complete = result.complete && !incomplete;
            if (!result.next) break;
            if (cursors.has(result.next)) throw new FeedError('Source repeated a page cursor. Imported jobs were kept.');
            cursors.add(result.next); cursor = result.next;
          }
          if (complete && !this.stopping && ['greenhouse', 'lever', 'ashby', 'smartrecruiters', ...AGGREGATORS].includes(source.provider)) {
            await this.prisma.jobPoolJob.updateMany({ where: { sourceId: source.id, lastSeenAt: { lt: started }, isActive: true }, data: { isActive: false } });
          }
          if (!complete) lastError = incomplete ? 'Some source postings have no description. Valid jobs were imported; older jobs were not closed.' : 'Import paused before the end of the feed. Imported jobs were kept; older jobs were not closed.';
          succeeded = complete;
        } catch (error) {
          lastError = error instanceof FeedError ? error.message : 'Could not finish this source. Imported jobs were kept; the next refresh will retry.';
          this.logger.warn({ sourceId: source.id, sourceName: source.name, provider: source.provider, reason: lastError,
            status: error instanceof FeedError ? error.status : undefined, errorType: (error as Error)?.name, errorCode: (error as { code?: string })?.code });
          if (error instanceof FeedError) delay = Math.max(delay, error.retryAfterMs);
        } finally {
          await this.prisma.jobPoolSource.updateMany({ where: { id: source.id, lastAttemptAt: started }, data: { queued: false, lockedUntil: null, lastError, lastCount: count,
            ...(succeeded ? { lastSyncedAt: new Date() } : {}), nextSyncAt: new Date(Date.now() + delay) } });
          stats.checked++; stats.processed += count; if (lastError) stats.retries++;
        }
      }
    }));
    const after = await this.prisma.jobPoolJob.count({ where: this.available() });
    this.logger.log(`${lane === 'boards' ? 'Employer boards' : 'Aggregate feeds'}: ${stats.checked} sources checked, ${stats.processed} matching listings processed, ${stats.retries} sources need retry; ${after} jobs available (${after >= before ? '+' : ''}${after - before}).`);
  }
  private jobFilters(user: AuthUser, query: Record<string, string | undefined>, asOf: Date, availableAt = new Date()): Prisma.JobPoolJobWhereInput {
    const where: Prisma.JobPoolJobWhereInput = { ...this.available(availableAt), ...(user.role === 'MASTER' && query.includeHidden === 'true' ? { hidden: undefined } : {}) };
    if (query.q?.trim()) where.AND = [{ OR: ['title', 'company', 'location', 'description'].map(field => ({ [field]: { contains: query.q!.trim().slice(0, 200), mode: 'insensitive' } })) }];
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.days && query.days !== 'all') {
      if (!['1', '3', '7', '14', '30'].includes(query.days)) throw new BadRequestException('Choose a valid posting date filter.');
      where.postedAt = { gte: new Date(asOf.getTime() - Number(query.days) * DAY) };
    }
    const status = query.status || 'not-applied';
    if (!['all', 'applied', 'not-applied'].includes(status)) throw new BadRequestException('Choose a valid applied status.');
    if (status !== 'all') where.appliedBy = status === 'applied' ? { some: { userId: user.id } } : { none: { userId: user.id } };
    return where;
  }
  async updates(user: AuthUser, query: Record<string, string | undefined>) {
    const now = new Date(), since = query.since && query.since.length <= 80 ? jobDate(query.since) : null;
    if (!since || since > now) throw new BadRequestException('Refresh the job list to check for new imports.');
    const where = this.jobFilters(user, query, now);
    const [total, newCount] = await Promise.all([this.prisma.jobPoolJob.count({where}), this.prisma.jobPoolJob.count({where: {...where, createdAt: {gt: since, lte: now}}})]);
    return {total, newCount, checkedAt: now.toISOString()};
  }
  async list(user: AuthUser, query: Record<string, string | undefined>) {
    const limit = 20, now = new Date();
    let cursor: { at: string; id: string; asOf: string } | undefined;
    if (query.cursor) {
      try {
        if (query.cursor.length > 1000) throw Error();
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        if (!cursor || typeof cursor.id !== 'string' || cursor.id.length > 100 || !jobDate(cursor.at) || !jobDate(cursor.asOf) || new Date(cursor.asOf) > now) throw Error();
      } catch { throw new BadRequestException('Invalid job cursor. Refresh the job list.'); }
    }
    const asOf = cursor ? new Date(cursor.asOf) : now;
    const where = { ...this.jobFilters(user, query, asOf, now), createdAt: { lte: asOf } };
    const filters = (where.AND || []) as Prisma.JobPoolJobWhereInput[];
    const pageWhere = cursor ? { ...where, AND: [...filters, { OR: [{ postedAt: { lt: new Date(cursor.at) } }, { postedAt: new Date(cursor.at), id: { lt: cursor.id } }] }] } : where;
    const include = { appliedBy: { where: { userId: user.id }, select: { appliedAt: true } } };
    const [jobs, total, sources] = await Promise.all([
      this.prisma.jobPoolJob.findMany({ where: pageWhere, take: limit + 1, orderBy: [{ postedAt: 'desc' }, { id: 'desc' }], include }),
      this.prisma.jobPoolJob.count({ where }), this.prisma.jobPoolSource.findMany({ select: { id: true, name: true, provider: true }, orderBy: { name: 'asc' } }),
    ]);
    const visible = jobs.slice(0, limit), last = visible.at(-1);
    return { asOf: asOf.toISOString(), jobs: visible.map(({ appliedBy, ...job }) => ({ ...job, applied: appliedBy.length > 0, appliedAt: appliedBy[0]?.appliedAt || null, description: job.description.slice(0, 280) })), total,
      nextCursor: jobs.length > limit && last ? Buffer.from(JSON.stringify({ at: last.postedAt.toISOString(), id: last.id, asOf: asOf.toISOString() })).toString('base64url') : null, sources };
  }
  async detail(id: string, user: AuthUser) {
    const job = await this.prisma.jobPoolJob.findFirst({ where: { id, ...(user.role === 'MASTER' ? { workArrangement: 'REMOTE', isSoftware: true } : this.available()) }, include: { appliedBy: { where: { userId: user.id }, select: { appliedAt: true } } } });
    if (!job) throw new NotFoundException('This job is no longer available.');
    const { appliedBy, ...data } = job; return { ...data, applied: appliedBy.length > 0, appliedAt: appliedBy[0]?.appliedAt || null };
  }
  async markApplied(user: AuthUser, id: string, body: Record<string, unknown>) {
    if (typeof body.applied !== 'boolean') throw new BadRequestException('Choose whether you have applied to this job.');
    await this.detail(id, user);
    if (body.applied) {
      const row = await this.prisma.jobPoolApplied.upsert({ where: { userId_jobId: { userId: user.id, jobId: id } }, create: { userId: user.id, jobId: id }, update: {} });
      return { applied: true, appliedAt: row.appliedAt };
    }
    await this.prisma.jobPoolApplied.deleteMany({ where: { userId: user.id, jobId: id } });
    return { applied: false, appliedAt: null };
  }
  async addJob(user: AuthUser, body: Record<string, unknown>) {
    this.master(user);
    if (body.workArrangement !== undefined && body.workArrangement !== 'REMOTE') throw new BadRequestException('Only remote US jobs can be published in the Job Pool.');
    const title = plainText(body.title, 250), company = plainText(body.company, 250), location = plainText(body.location, 1000), description = plainText(body.description);
    const jobUrl = publicJobUrl(body.jobUrl);
    if (!title || !company || !description || !jobUrl || !isUsLocation(location)) throw new BadRequestException('Enter a title, company, US location, description and a valid public HTTP or HTTPS job URL.');
    if (!isSoftwareJob(title, description)) throw new BadRequestException('Only software jobs can be published. Use a specific software, development, data, QA, cloud or DevOps job title.');
    const expiresAt = body.expiresAt ? jobDate(body.expiresAt) : new Date(Date.now() + 30 * DAY);
    if (!expiresAt || expiresAt <= new Date()) throw new BadRequestException('Choose an expiration date in the future.');
    const canonicalUrl = normalizedJobUrl(jobUrl)!;
    try { return await this.prisma.jobPoolJob.create({ data: { externalId: canonicalUrl, canonicalUrl, title, company, location, description, jobUrl,
      sourceName: 'Added by Master', publishedAt: new Date(), postedAt: new Date(), isSoftware: true, expiresAt, workArrangement: 'REMOTE' } }); }
    catch (error) { if ((error as { code?: string }).code === 'P2002') throw new BadRequestException('This job link is already in the Job Pool.'); throw error; }
  }
  async hide(user: AuthUser, id: string, body: Record<string, unknown>) {
    this.master(user); if (typeof body.hidden !== 'boolean') throw new BadRequestException('Choose whether to hide this job.');
    await this.detail(id, user); return this.prisma.jobPoolJob.update({ where: { id }, data: { hidden: body.hidden } });
  }
  async apply(user: AuthUser, id: string, body: Record<string, unknown>) {
    if (!['ADMIN', 'BIDDER'].includes(user.role)) throw new ForbiddenException('Master accounts manage jobs; Admin and Bidder accounts create applications.');
    if (typeof body.profileId !== 'string' || !body.profileId.trim()) throw new BadRequestException('Select one of your profiles.');
    const job = await this.prisma.jobPoolJob.findFirst({ where: { id, ...this.available() } });
    if (!job) throw new NotFoundException('This job is no longer available.');
    // Use saved job data and the existing application permission / warning checks.
    return this.applications.create({ profileId: body.profileId, jobTitle: job.title, company: job.company, location: job.location,
      jobUrl: job.jobUrl, jobDescription: job.description, workArrangement: job.workArrangement, source: job.sourceName }, user);
  }
}
