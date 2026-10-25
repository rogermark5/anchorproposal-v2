import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { employerBoard } from './company-discovery';
import { fetchJobPage, FeedError } from './job-providers';
import { DEFAULT_EXCLUDED_TITLE_KEYWORDS, isSoftwareJob, normalizeTitleKeywords } from './software-jobs';
import { createHash } from 'node:crypto';
import { isFreshPoolPosting, poolPostingWindow } from './job-freshness';

const DAY = 86400_000;
@Injectable()
export class CompanyDiscoveryService {
  private running?: Promise<void>;
  private stopping = false;
  private requested = false;
  private logger = new Logger(CompanyDiscoveryService.name);
  constructor(private prisma: PrismaService) {}
  async onModuleDestroy() { this.stopping = true; await this.running; }
  start(force = false) {
    if (this.stopping) return Promise.resolve();
    if (force) this.requested = true;
    if (!this.running) this.running = this.run(force).catch(() => this.logger.warn('Company discovery will retry on its next pass.')).finally(() => { this.running = undefined; if (this.requested && !this.stopping) void this.start(); });
    return this.running;
  }
  async summary() {
    const [pendingBoards, verifiedBoards] = await Promise.all([
      this.prisma.jobPoolBoardCandidate.count({ where: { state: 'pending' } }),
      this.prisma.jobPoolBoardCandidate.count({ where: { state: 'verified' } }),
    ]);
    return { pendingBoards, verifiedBoards, intervalHours: 24 };
  }
  private async run(force: boolean) {
    const requested = this.requested; this.requested = false;
    const saved = await this.prisma.systemSetting.findUnique({ where: { key: 'job_pool_settings' } });
    let settings: Record<string, any> = {}; try { settings = JSON.parse(saved?.value || '{}'); } catch {}
    if (!force && !requested && !this.requested && !settings.enabled) return;
    this.requested = false;
    let keywords = DEFAULT_EXCLUDED_TITLE_KEYWORDS;
    try { if (settings.excludedTitleKeywords !== undefined) keywords = normalizeTitleKeywords(settings.excludedTitleKeywords); } catch {}
    // Harvest a bounded slice each minute; a full pass repeats daily. This also
    // discovers boards in jobs imported before the feature was installed.
    const progress = await this.prisma.systemSetting.findUnique({ where: { key: 'job_pool_board_harvest' } });
    let scan: { after?: string; completedAt?: string } = {}; try { scan = JSON.parse(progress?.value || '{}'); } catch {}
    if (!scan.completedAt || Date.parse(scan.completedAt) <= Date.now() - DAY) {
      const rows = await this.prisma.jobPoolJob.findMany({ where: { isActive: true, isSoftware: true, hidden: false, workArrangement: 'REMOTE',
        lastSeenAt: { gte: new Date(Date.now() - 30 * DAY) }, AND: [poolPostingWindow()], ...(scan.after ? { id: { gt: scan.after } } : {}) },
        select: { id: true, jobUrl: true, company: true }, orderBy: { id: 'asc' }, take: 500 });
      const candidates = new Map<string, { provider: string; boardToken: string; name: string }>();
      for (const job of rows) { const board = employerBoard(job.jobUrl); if (board) candidates.set((board.provider + ':' + board.boardToken).toLowerCase(), { ...board, name: job.company.slice(0, 120) }); }
      const boards = [...candidates.values()];
      const existing = boards.length ? await this.prisma.jobPoolSource.findMany({ where: { OR: boards.map(({ provider, boardToken }) => ({ provider, boardToken: { equals: boardToken, mode: 'insensitive' as const } })) }, select: { provider: true, boardToken: true } }) : [];
      const registered = new Set(existing.map(row => (row.provider + ':' + row.boardToken).toLowerCase()));
      for (const board of boards) if (!registered.has((board.provider + ':' + board.boardToken).toLowerCase())) {
        await this.prisma.jobPoolBoardCandidate.upsert({ where: { provider_boardToken: { provider: board.provider, boardToken: board.boardToken } }, create: board, update: {} });
      }
      const value = JSON.stringify(rows.length === 500 ? { after: rows.at(-1)!.id } : { completedAt: new Date().toISOString() });
      await this.prisma.systemSetting.upsert({ where: { key: 'job_pool_board_harvest' }, create: { key: 'job_pool_board_harvest', value }, update: { value } });
    }
    const now = new Date();
    const candidates = await this.prisma.jobPoolBoardCandidate.findMany({ where: { state: 'pending', nextCheckAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, orderBy: { discoveredAt: 'asc' }, take: 20 });
    let index = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (index < candidates.length && !this.stopping) {
        const board = candidates[index++], checkedAt = new Date();
        const claim = await this.prisma.jobPoolBoardCandidate.updateMany({ where: { id: board.id, state: 'pending', nextCheckAt: { lte: checkedAt }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: checkedAt } }] }, data: { lockedUntil: new Date(Date.now() + 20 * 60_000) } });
        if (!claim.count) continue;
        try {
          const exists = await this.prisma.jobPoolSource.findFirst({ where: { provider: board.provider, boardToken: { equals: board.boardToken, mode: 'insensitive' } } });
          if (!exists) {
            const page = await fetchJobPage(board, null);
            if (!page.jobs.some(job => isSoftwareJob(job.title, job.description, keywords) && isFreshPoolPosting(job.publishedAt))) {
              await this.prisma.jobPoolBoardCandidate.update({ where: { id: board.id }, data: { checkedAt, lockedUntil: null, nextCheckAt: new Date(Date.now() + DAY), lastError: 'No qualifying remote software jobs posted today on the checked page.' } });
              continue;
            }
            const id = 'discovered-' + createHash('sha256').update((board.provider + ':' + board.boardToken).toLowerCase()).digest('hex').slice(0, 40);
            await this.prisma.jobPoolSource.upsert({ where: { id },
              create: { id, provider: board.provider, boardToken: board.boardToken, name: board.name, enabled: true, queued: true }, update: {} });
          }
          await this.prisma.jobPoolBoardCandidate.update({ where: { id: board.id }, data: { state: exists ? 'existing' : 'verified', checkedAt, lockedUntil: null, lastError: null } });
        } catch (error) {
          await this.prisma.jobPoolBoardCandidate.update({ where: { id: board.id }, data: { checkedAt, lockedUntil: null,
            nextCheckAt: new Date(Date.now() + Math.max(DAY, error instanceof FeedError ? error.retryAfterMs : DAY)),
            lastError: error instanceof FeedError ? error.message : 'Board verification failed; existing jobs were kept.' } });
        }
      }
    }));
  }
}
