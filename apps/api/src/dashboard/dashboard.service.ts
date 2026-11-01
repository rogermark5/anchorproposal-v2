import { Injectable, BadRequestException } from '@nestjs/common';
import { calendarDay, calendarDayStart, calendarRange, shiftCalendarDay, validCalendarDay, validTimeZone } from '@anchorproposal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationStatus, GenerationStatus, UserRole, Prisma } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';
import { isAdmin, isMaster } from '../common/utils/roles.util';
import { profileAccessWhere } from '../common/utils/profile-access';

export type DashboardMetricsFilters = {
  adminIds?: string[];
  bidderIds?: string[];
  statuses?: ApplicationStatus[];
  startDate?: string;
  endDate?: string;
  timeZone?: string;
};

const DEFAULT_TREND_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.APPLIED,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
];

const ALL_STATUSES = Object.values(ApplicationStatus);
const MAX_TREND_DAYS = 90;

function statusKey(status: ApplicationStatus): string {
  return status.toLowerCase();
}

function parseDay(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return d;
}

function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private async appWhere(user: AuthUser): Promise<Prisma.ApplicationWhereInput> {
    if (isMaster(user.role)) return {};
    if (isAdmin(user.role)) {
      const owned = await this.ownedBidderIds(user.id);
      return { bidderId: { in: [user.id, ...owned] }, profile: profileAccessWhere(user) };
    }
    return { bidderId: user.id, profile: profileAccessWhere(user) };
  }

  private async ownedBidderIds(adminId: string): Promise<string[]> {
    const owned = await this.prisma.user.findMany({
      where: { role: UserRole.BIDDER, managedByAdminId: adminId },
      select: { id: true },
    });
    return owned.map((b) => b.id);
  }

  private async resolveBidderIds(
    user: AuthUser,
    filters: DashboardMetricsFilters,
  ): Promise<string[] | undefined> {
    if (isAdmin(user.role)) {
      const allowed = [user.id, ...(await this.ownedBidderIds(user.id))];
      if (!filters.bidderIds?.length) return undefined;
      return filters.bidderIds.filter((id) => allowed.includes(id));
    }

    if (!isMaster(user.role)) return undefined;

    const { adminIds, bidderIds } = filters;
    if (!adminIds?.length && !bidderIds?.length) return undefined;

    let fromAdmins: string[] | undefined;
    if (adminIds?.length) {
      const bidders = await this.prisma.user.findMany({
        where: { role: UserRole.BIDDER, managedByAdminId: { in: adminIds } },
        select: { id: true },
      });
      fromAdmins = [...adminIds, ...bidders.map((b) => b.id)];
    }

    if (bidderIds?.length && fromAdmins) {
      return bidderIds.filter((id) => fromAdmins!.includes(id));
    }
    if (bidderIds?.length) return bidderIds;
    return fromAdmins;
  }

  private tableDateStatusOnly(filters: DashboardMetricsFilters): Prisma.ApplicationWhereInput {
    const tableDateStatusWhere = this.buildWhere({}, filters, undefined, {
      applyStatus: true,
      applyDates: true,
    });
    const dateStatusOnly: Prisma.ApplicationWhereInput = {};
    if (tableDateStatusWhere.status) dateStatusOnly.status = tableDateStatusWhere.status;
    if (tableDateStatusWhere.createdAt) dateStatusOnly.createdAt = tableDateStatusWhere.createdAt;
    return dateStatusOnly;
  }

  private async countBidderRow(
    bidderId: string,
    dateStatusOnly: Prisma.ApplicationWhereInput,
    filters: DashboardMetricsFilters,
  ): Promise<{ total: number; interviews: number; offers: number }> {
    const appWhere: Prisma.ApplicationWhereInput = {
      ...dateStatusOnly,
      bidderId,
    };
    const [total, interviews, offers] = await Promise.all([
      this.prisma.application.count({ where: appWhere }),
      !filters.statuses?.length || filters.statuses.includes(ApplicationStatus.INTERVIEW)
        ? this.prisma.application.count({
            where: {
              bidderId,
              ...(dateStatusOnly.profile ? { profile: dateStatusOnly.profile } : {}),
              ...(dateStatusOnly.createdAt ? { createdAt: dateStatusOnly.createdAt } : {}),
              status: ApplicationStatus.INTERVIEW,
            },
          })
        : Promise.resolve(0),
      !filters.statuses?.length || filters.statuses.includes(ApplicationStatus.OFFER)
        ? this.prisma.application.count({
            where: {
              bidderId,
              ...(dateStatusOnly.profile ? { profile: dateStatusOnly.profile } : {}),
              ...(dateStatusOnly.createdAt ? { createdAt: dateStatusOnly.createdAt } : {}),
              status: ApplicationStatus.OFFER,
            },
          })
        : Promise.resolve(0),
    ]);
    return { total, interviews, offers };
  }

  private buildWhere(
    roleWhere: Prisma.ApplicationWhereInput,
    filters: DashboardMetricsFilters,
    bidderIds: string[] | undefined,
    options?: { applyStatus?: boolean; applyDates?: boolean },
  ): Prisma.ApplicationWhereInput {
    const applyStatus = options?.applyStatus !== false;
    const applyDates = options?.applyDates !== false;
    const where: Prisma.ApplicationWhereInput = { ...roleWhere };

    if (bidderIds !== undefined) {
      where.bidderId = { in: bidderIds };
    }

    if (applyStatus && filters.statuses?.length) {
      where.status = { in: filters.statuses };
    }

    if (applyDates && (filters.startDate || filters.endDate)) {
      where.createdAt = {};
      if (filters.startDate) {
        (where.createdAt as Prisma.DateTimeFilter).gte = calendarDayStart(filters.startDate, filters.timeZone || 'UTC');
      }
      if (filters.endDate) {
        (where.createdAt as Prisma.DateTimeFilter).lt = calendarDayStart(shiftCalendarDay(filters.endDate, 1), filters.timeZone || 'UTC');
      }
    }

    return where;
  }

  private resolveTrendWindow(filters: DashboardMetricsFilters): { start: Date; end: Date; days: number } {
    const today = parseDay(calendarDay(new Date(), filters.timeZone || 'UTC'));

    let end = filters.endDate ? parseDay(filters.endDate) : today;
    let start = filters.startDate
      ? parseDay(filters.startDate)
      : new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);

    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    let days = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (days > MAX_TREND_DAYS) {
      start = new Date(end.getTime() - (MAX_TREND_DAYS - 1) * 24 * 60 * 60 * 1000);
      days = MAX_TREND_DAYS;
    }

    return { start, end, days };
  }

  private resolveTrendStatuses(filters: DashboardMetricsFilters): ApplicationStatus[] {
    if (filters.statuses?.length) {
      return filters.statuses.filter((s) => ALL_STATUSES.includes(s));
    }
    return DEFAULT_TREND_STATUSES;
  }

  async getMetrics(user: AuthUser, filters: DashboardMetricsFilters = {}) {
    const saved = await this.prisma.systemSetting.findUnique({ where: { key: `time_zone:${user.id}` } });
    filters = { ...filters, timeZone: validTimeZone(saved?.value) ? saved.value : 'UTC' };
    if (filters.startDate && !validCalendarDay(filters.startDate) || filters.endDate && !validCalendarDay(filters.endDate) || filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw new BadRequestException('Choose a valid date range.');
    const roleWhere = await this.appWhere(user);
    const bidderIds = await this.resolveBidderIds(user, filters);
    // Overview KPIs ignore analytics status chips — always count true pipeline volumes
    // within role / bidder / date scope. Status filter still applies to trend + tables.
    const kpiWhere = this.buildWhere(roleWhere, filters, bidderIds, {
      applyStatus: false,
      applyDates: true,
    });
    const where = this.buildWhere(roleWhere, filters, bidderIds);

    const countForStatus = (status: ApplicationStatus) =>
      this.prisma.application.count({ where: { ...kpiWhere, status } });

    const [total, applied, interviews, offers, warnings] = await Promise.all([
      this.prisma.application.count({ where: kpiWhere }),
      countForStatus(ApplicationStatus.APPLIED),
      countForStatus(ApplicationStatus.INTERVIEW),
      countForStatus(ApplicationStatus.OFFER),
      this.prisma.applicationWarning.count({
        where: {
          acknowledgedAt: null,
          application: kpiWhere,
        },
      }),
    ]);

    const trendStatuses = this.resolveTrendStatuses(filters);
    const { start, end, days } = this.resolveTrendWindow(filters);

    // Trend: date window always applied; status series counted per day (not AND-filtered away)
    const trendWhere = this.buildWhere(roleWhere, filters, bidderIds, {
      applyStatus: false,
      applyDates: false,
    });
    trendWhere.createdAt = calendarRange(toDateStr(start), toDateStr(end), filters.timeZone!);

    const recentApps = await this.prisma.application.findMany({
      where: trendWhere,
      select: { createdAt: true, status: true },
    });

    const trend = Array.from({ length: days }, (_, i) => {
      const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = toDateStr(date);
      const dayApps = recentApps.filter((a) => calendarDay(a.createdAt, filters.timeZone!) === dateStr);
      const point: Record<string, string | number> = { date: dateStr };
      for (const status of trendStatuses) {
        point[statusKey(status)] = dayApps.filter((a) => a.status === status).length;
      }
      return point;
    });

    const genWhere: Prisma.ResumeGenerationWhereInput = {
      status: GenerationStatus.COMPLETED,
      application: where,
    };

    const recentGenerations = await this.prisma.resumeGeneration.findMany({
      where: genWhere,
      include: {
        application: { select: { jobTitle: true, company: true } },
        creator: { select: { firstName: true, lastName: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });

    const result: Record<string, unknown> = {
      kpis: { total, applied, readyToApply: applied, interviews, offers, warnings },
      trend,
      recentGenerations: recentGenerations.map((g) => ({
        id: g.id,
        jobTitle: g.application.jobTitle,
        company: g.application.company,
        creator: `${g.creator.firstName} ${g.creator.lastName}`,
        completedAt: g.completedAt,
      })),
    };

    if (isMaster(user.role)) {
      const dateStatusOnly = this.tableDateStatusOnly(filters);

      const adminFilter = filters.adminIds?.length
        ? { id: { in: filters.adminIds } }
        : {};

      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, ...adminFilter },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });

      const byAdmin = await Promise.all(
        admins.map(async (admin) => {
          const bidders = await this.ownedBidderIds(admin.id);
          const scopeIds = [admin.id, ...bidders];
          const appWhere: Prisma.ApplicationWhereInput = {
            ...dateStatusOnly,
            bidderId: { in: scopeIds },
          };
          const [aTotal, aInterviews, aOffers] = await Promise.all([
            this.prisma.application.count({ where: appWhere }),
            !filters.statuses?.length || filters.statuses.includes(ApplicationStatus.INTERVIEW)
              ? this.prisma.application.count({
                  where: {
                    bidderId: { in: scopeIds },
                    ...(dateStatusOnly.createdAt ? { createdAt: dateStatusOnly.createdAt } : {}),
                    status: ApplicationStatus.INTERVIEW,
                  },
                })
              : Promise.resolve(0),
            !filters.statuses?.length || filters.statuses.includes(ApplicationStatus.OFFER)
              ? this.prisma.application.count({
                  where: {
                    bidderId: { in: scopeIds },
                    ...(dateStatusOnly.createdAt ? { createdAt: dateStatusOnly.createdAt } : {}),
                    status: ApplicationStatus.OFFER,
                  },
                })
              : Promise.resolve(0),
          ]);
          return {
            adminId: admin.id,
            name: `${admin.firstName} ${admin.lastName}`,
            total: aTotal,
            interviews: aInterviews,
            offers: aOffers,
            bidderCount: bidders.length,
          };
        }),
      );

      result.byAdmin = byAdmin;

      const bidderWhere: Prisma.UserWhereInput = { role: UserRole.BIDDER };
      if (filters.adminIds?.length) {
        bidderWhere.managedByAdminId = { in: filters.adminIds };
      }
      if (filters.bidderIds?.length) {
        bidderWhere.id = { in: filters.bidderIds };
      }

      const bidders = await this.prisma.user.findMany({
        where: bidderWhere,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          managedByAdminId: true,
          managedByAdmin: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });

      const byBidder = await Promise.all(
        bidders.map(async (bidder) => {
          const counts = await this.countBidderRow(bidder.id, dateStatusOnly, filters);
          const adminName = bidder.managedByAdmin
            ? `${bidder.managedByAdmin.firstName} ${bidder.managedByAdmin.lastName}`
            : '—';
          return {
            bidderId: bidder.id,
            name: `${bidder.firstName} ${bidder.lastName}`,
            adminName,
            ...counts,
          };
        }),
      );

      result.byBidder = byBidder;

      const [allAdmins, allBidders] = await Promise.all([
        this.prisma.user.findMany({
          where: { role: UserRole.ADMIN },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        }),
        this.prisma.user.findMany({
          where: { role: UserRole.BIDDER },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            managedByAdminId: true,
          },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        }),
      ]);

      result.filterOptions = {
        admins: allAdmins.map((a) => ({
          id: a.id,
          name: `${a.firstName} ${a.lastName}`,
        })),
        bidders: allBidders.map((b) => ({
          id: b.id,
          name: `${b.firstName} ${b.lastName}`,
          adminId: b.managedByAdminId,
        })),
      };
    } else if (isAdmin(user.role)) {
      const dateStatusOnly = this.tableDateStatusOnly(filters);
      dateStatusOnly.profile = profileAccessWhere(user);
      const ownedIds = await this.ownedBidderIds(user.id);
      const allowedIds = [user.id, ...ownedIds];
      const selectedIds = filters.bidderIds?.length
        ? filters.bidderIds.filter((id) => allowedIds.includes(id))
        : allowedIds;

      if (selectedIds.length === 0) {
        result.byBidder = [];
      } else {
        const people = await this.prisma.user.findMany({
          where: { id: { in: selectedIds } },
          select: { id: true, firstName: true, lastName: true, role: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        });

        // Keep admin (self) first, then bidders alphabetically
        people.sort((a, b) => {
          if (a.id === user.id) return -1;
          if (b.id === user.id) return 1;
          return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
        });

        result.byBidder = await Promise.all(
          people.map(async (person) => {
            const counts = await this.countBidderRow(person.id, dateStatusOnly, filters);
            return {
              bidderId: person.id,
              name: `${person.firstName} ${person.lastName}`,
              adminName: '—',
              ...counts,
            };
          }),
        );
      }

      const self = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, firstName: true, lastName: true },
      });
      const ownedBidders = await this.prisma.user.findMany({
        where: { role: UserRole.BIDDER, managedByAdminId: user.id },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });

      result.filterOptions = {
        admins: [],
        bidders: [
          ...(self
            ? [{ id: self.id, name: `${self.firstName} ${self.lastName}`, adminId: null as string | null }]
            : []),
          ...ownedBidders.map((b) => ({
            id: b.id,
            name: `${b.firstName} ${b.lastName}`,
            adminId: user.id as string | null,
          })),
        ],
      };
    }

    return result;
  }
}
