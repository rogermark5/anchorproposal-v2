import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { normalizedJobUrl } from './job-url';
import { bindProfileOutput, hasProfileIdentityConflict, redactPromptMetadata } from '../generations/profile-output';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RulesService } from '../rules/rules.service';
import { StorageService } from '../storage/storage.service';
import { normalizeCompany } from '@anchorproposal/shared';
import {
  ApplicationStatus,
  UserRole,
  WorkArrangement,
  GenerationStatus,
  FileType,
  GenerationFileKind,
  Prisma,
} from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';
import { canBid, isAdmin, isMaster } from '../common/utils/roles.util';

export type LatestFiles = {
  resumePdfId: string | null;
  resumeDocxId: string | null;
  coverLetterPdfId: string | null;
  coverLetterDocxId: string | null;
};

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private profilesService: ProfilesService,
    private rulesService: RulesService,
    private storage: StorageService,
  ) {}

  private async applicationScopeWhere(
    user: AuthUser,
    listScope?: 'mine' | 'team',
  ): Promise<Record<string, unknown>> {
    if (isMaster(user.role)) {
      return {};
    }
    if (isAdmin(user.role)) {
      const owned = await this.prisma.user.findMany({
        where: { role: UserRole.BIDDER, managedByAdminId: user.id },
        select: { id: true },
      });
      const ownedIds = owned.map((b) => b.id);
      if (listScope === 'mine') {
        return { bidderId: user.id };
      }
      if (listScope === 'team') {
        return { bidderId: { in: ownedIds } };
      }
      return { bidderId: { in: [user.id, ...ownedIds] } };
    }
    return { bidderId: user.id };
  }

  private async assertCanAccessApp(
    app: { bidderId: string; profileId: string },
    user: AuthUser,
  ) {
    await this.profilesService.checkAccess(app.profileId, user);
    if (isMaster(user.role)) return;
    if (isAdmin(user.role)) {
      if (app.bidderId === user.id) return;
      const bidder = await this.prisma.user.findUnique({ where: { id: app.bidderId } });
      if (bidder?.managedByAdminId === user.id) return;
      throw new ForbiddenException('Access denied');
    }
    if (app.bidderId !== user.id) {
      throw new ForbiddenException('Access denied');
    }
  }

  private latestFilesFromGeneration(
    files: { id: string; type: FileType; kind: GenerationFileKind }[],
  ): LatestFiles {
    const find = (kind: GenerationFileKind, type: FileType) =>
      files.find((f) => f.kind === kind && f.type === type)?.id ?? null;
    return {
      resumePdfId: find(GenerationFileKind.RESUME, FileType.PDF),
      resumeDocxId: find(GenerationFileKind.RESUME, FileType.DOCX),
      coverLetterPdfId: find(GenerationFileKind.COVER_LETTER, FileType.PDF),
      coverLetterDocxId: find(GenerationFileKind.COVER_LETTER, FileType.DOCX),
    };
  }

  async findAll(
    user: AuthUser,
    filters: {
      status?: ApplicationStatus;
      profileId?: string;
      q?: string;
      warningState?: string;
      scope?: 'mine' | 'team';
      limit?: number;
    },
  ) {
    const listScope =
      filters.scope === 'mine' || filters.scope === 'team' ? filters.scope : undefined;
    const scope = await this.applicationScopeWhere(user, listScope);
    const where: Record<string, unknown> = { ...scope };

    if (filters.status) where.status = filters.status;
    if (filters.profileId) where.profileId = filters.profileId;
    if (filters.q) {
      where.OR = [
        { jobTitle: { contains: filters.q, mode: 'insensitive' } },
        { company: { contains: filters.q, mode: 'insensitive' } },
        { location: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const apps = await this.prisma.application.findMany({
      where,
      ...(Number.isFinite(filters.limit) ? { take: Math.max(1, Math.min(100, Math.floor(filters.limit!))) } : {}),
      include: {
        profile: { select: { id: true, firstName: true, lastName: true, profileTitle: true } },
        bidder: { select: { id: true, firstName: true, lastName: true } },
        warnings: true,
        _count: { select: { generations: true } },
        generations: {
          where: { status: GenerationStatus.COMPLETED },
          orderBy: { version: 'desc' },
          take: 1,
          include: { files: { select: { id: true, type: true, kind: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return apps.map((app) => {
      const { generations, ...rest } = app;
      const latest = generations[0];
      return {
        ...rest,
        warnings: this.rulesService.contextualizeWarnings(app.warnings, app),
        latestGenerationId: latest?.id ?? null,
        latestFiles: latest && !hasProfileIdentityConflict(latest.structuredOutputJson as any, latest.profileSnapshotJson)
          ? this.latestFilesFromGeneration(latest.files)
          : {
              resumePdfId: null,
              resumeDocxId: null,
              coverLetterPdfId: null,
              coverLetterDocxId: null,
            },
      };
    });
  }

  async page(user: AuthUser, query: Record<string,string|undefined>) {
    if (Object.values(query).some(value=>value!==undefined&&typeof value!=='string')) throw new BadRequestException('Invalid application filters.');
    const now = new Date();
    let cursor: { at: string; id: string; asOf: string } | undefined;
    if (query.cursor) {
      try {
        if (query.cursor.length > 1000) throw Error();
        cursor = JSON.parse(Buffer.from(query.cursor,'base64url').toString());
        if (!cursor || typeof cursor.id !== 'string' || !cursor.id.length || cursor.id.length > 100 || typeof cursor.at!=='string' || typeof cursor.asOf!=='string' || !Number.isFinite(Date.parse(cursor.at)) || !Number.isFinite(Date.parse(cursor.asOf)) || new Date(cursor.asOf) > now || new Date(cursor.at)>new Date(cursor.asOf)) throw Error();
      } catch { throw new BadRequestException('Refresh the application list to continue.'); }
    }
    if (query.status && !Object.values(ApplicationStatus).includes(query.status as ApplicationStatus)) throw new BadRequestException('Choose an application status.');
    const asOf = cursor ? new Date(cursor.asOf) : now;
    const where: Prisma.ApplicationWhereInput = { AND: [{ bidderId:user.id }, { createdAt: { lte: asOf } },
      ...(query.profileId ? [{profileId:query.profileId.slice(0,100)}] : []),
      ...(query.status ? [{status:query.status as ApplicationStatus}] : []),
      ...(query.q?.trim() ? [{OR:['jobTitle','company','location'].map(field=>({[field]:{contains:query.q!.trim().slice(0,200),mode:'insensitive' as const}}))}] : []),
    ] };
    const pageWhere = cursor ? {AND:[where,{OR:[{createdAt:{lt:new Date(cursor.at)}},{createdAt:new Date(cursor.at),id:{lt:cursor.id}}]}]} : where;
    const [rows,total] = await Promise.all([this.prisma.application.findMany({where:pageWhere,take:21,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{
      id:true,jobTitle:true,company:true,location:true,status:true,profileId:true,createdAt:true,updatedAt:true,
      profile:{select:{firstName:true,lastName:true,profileTitle:true}},
      generations:{orderBy:{version:'desc'},take:1,select:{id:true,status:true,version:true,errorMessage:true}},
    }}),this.prisma.application.count({where})]);
    const apps = rows.slice(0,20), last = apps.at(-1);
    return { applications: apps, total, asOf:asOf.toISOString(), nextCursor: rows.length>20 && last ? Buffer.from(JSON.stringify({id:last.id,at:last.createdAt.toISOString(),asOf:asOf.toISOString()})).toString('base64url') : null };
  }

  async findOne(id: string, user: AuthUser) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: {
        profile: {
          include: {
            experiences: { orderBy: { sortOrder: 'asc' } },
            education: true,
            skills: true,
            certifications: true,
            links: true,
          },
        },
        bidder: { select: { id: true, firstName: true, lastName: true, email: true } },
        warnings: true,
        notes: {
          include: { author: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        statusHistory: {
          include: { actor: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        generations: {
          include: { files: true, promptVersion: true, templateVersion: true },
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!app) throw new NotFoundException('Application not found');
    await this.assertCanAccessApp(app, user);
    return { ...app, generations: app.generations.map(gen => gen.structuredOutputJson ? { ...redactPromptMetadata(gen), requiresRegeneration: hasProfileIdentityConflict(gen.structuredOutputJson as any, gen.profileSnapshotJson), structuredOutputJson: bindProfileOutput(gen.structuredOutputJson as any, gen.profileSnapshotJson, gen.isUserEdited) } : redactPromptMetadata(gen)), warnings: this.rulesService.contextualizeWarnings(app.warnings, app) };
  }

  async create(data: Record<string, unknown>, user: AuthUser) {
    if (!canBid(user.role)) {
      throw new ForbiddenException('Master accounts cannot create applications');
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser?.canCreateApplications) {
      throw new ForbiddenException('You do not have permission to create applications');
    }

    const profileId = data.profileId as string;
    await this.profilesService.checkAccess(profileId, user);
    const canonicalUrl = normalizedJobUrl(data.jobUrl);
    const jobUrl = canonicalUrl ? (data.jobUrl as string).trim() : null;

    const validation = await this.rulesService.validateApplication({
      jobTitle: data.jobTitle as string,
      company: data.company as string,
      location: data.location as string,
      workArrangement: data.workArrangement as string,
      jobDescription: data.jobDescription as string,
      profileId,
      jobUrl: jobUrl ?? undefined,
    });

    const app = await this.prisma.application.create({
      data: {
        profileId,
        bidderId: user.id,
        jobTitle: data.jobTitle as string,
        company: data.company as string,
        normalizedCompany: normalizeCompany(data.company as string),
        location: data.location as string,
        workArrangement: (data.workArrangement as WorkArrangement) || WorkArrangement.UNKNOWN,
        source: data.source as string,
        jobUrl,
        normalizedJobUrl: canonicalUrl,
        jobDescription: data.jobDescription as string,
        status: ApplicationStatus.SAVED,
        warnings: {
          create: validation.warnings.map((w) => ({
            category: w.category,
            matchedText: w.matchedText,
            severity: w.severity,
            behavior: w.behavior,
          })),
        },
        statusHistory: {
          create: {
            toStatus: ApplicationStatus.SAVED,
            actorId: user.id,
            note: 'Application created',
          },
        },
      },
      include: { warnings: true, profile: true },
    });

    return { ...app, duplicates: validation.duplicates };
  }

  // Read-only preview: never creates an application, warning, or status history.
  async validateDraft(data: Record<string, unknown>, user: AuthUser) {
    if (!canBid(user.role)) throw new ForbiddenException('Master accounts cannot create applications');
    const account = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!account?.canCreateApplications) throw new ForbiddenException('You do not have permission to create applications');
    if (typeof data.profileId !== 'string' || !data.profileId) throw new BadRequestException('Select a profile to validate the description.');
    await this.profilesService.checkAccess(data.profileId, user);
    for (const field of ['jobTitle', 'company', 'location', 'workArrangement', 'jobDescription', 'jobUrl']) {
      if (data[field] !== undefined && (typeof data[field] !== 'string' || (data[field] as string).length > (field === 'jobDescription' ? 100000 : 5000))) throw new BadRequestException('Invalid application details.');
    }
    const validation = await this.rulesService.validateApplication({
      profileId: data.profileId, jobTitle: String(data.jobTitle || ''), company: String(data.company || ''),
      location: String(data.location || ''), workArrangement: String(data.workArrangement || ''),
      jobDescription: String(data.jobDescription || ''), jobUrl: String(data.jobUrl || ''),
    });
    // Preview consumers only need warning text; do not disclose other bidders' records.
    return { warnings: validation.warnings, ...this.rulesService.canGenerate(validation.warnings) };
  }

  async matchingCompanies(user: AuthUser, companies: string[]) {
    const key = (name: string) => name.toLowerCase().replace(/\s/g, '');
    const wanted = new Set(companies.map(key).filter(Boolean));
    const matches: Record<string, { id: string; company: string; jobTitle: string; profileId: string; profileName: string }[]> = Object.create(null);
    if (!wanted.size) return matches;
    const applications = await this.prisma.application.findMany({
      where: { bidderId: user.id, ...(!isAdmin(user.role) && !isMaster(user.role) ? { profile: { assignments: { some: { userId: user.id, activeTo: null } } } } : {}) },
      select: { id: true, company: true, jobTitle: true, profileId: true, profile: { select: { firstName: true, lastName: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    for (const application of applications) {
      const normalized = key(application.company);
      if (wanted.has(normalized)) {
        const { profile, ...details } = application;
        (matches[normalized] ||= []).push({ ...details, profileName: [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Profile not recorded' });
      }
    }
    return matches;
  }

  async profileForPool(profileId: string, user: AuthUser) {
    await this.profilesService.checkAccess(profileId, user);
    const profile = await this.prisma.profile.findFirst({ where: { id: profileId, archivedAt: null }, select: { id: true } });
    if (!profile) throw new NotFoundException('Select an active profile you can access.');
    return profile;
  }

  async update(
    id: string,
    data: {
      profileId?: string;
      jobTitle?: string;
      company?: string;
      location?: string;
      workArrangement?: WorkArrangement;
      source?: string;
      jobUrl?: string | null;
      jobDescription?: string;
    },
    user: AuthUser,
  ) {
    if (isMaster(user.role)) {
      throw new ForbiddenException('Master accounts cannot modify applications');
    }
    const app = await this.findOne(id, user);

    if (data.profileId && data.profileId !== app.profileId) {
      await this.profilesService.checkAccess(data.profileId, user);
    }

    const company = data.company ?? app.company;
    const submittedUrl = data.jobUrl !== undefined ? data.jobUrl : app.jobUrl;
    const canonicalUrl = normalizedJobUrl(submittedUrl);
    const jobUrl = canonicalUrl ? submittedUrl!.trim() : null;
    const updateData: Prisma.ApplicationUpdateInput = {
      ...((data.profileId !== undefined || data.jobUrl !== undefined) ? { normalizedJobUrl: canonicalUrl } : {}),
      ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle } : {}),
      ...(data.company !== undefined
        ? { company: data.company, normalizedCompany: normalizeCompany(company) }
        : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.workArrangement !== undefined ? { workArrangement: data.workArrangement } : {}),
      ...(data.source !== undefined ? { source: data.source } : {}),
      ...(data.jobUrl !== undefined ? { jobUrl } : {}),
      ...(data.jobDescription !== undefined ? { jobDescription: data.jobDescription } : {}),
      ...(data.profileId !== undefined ? { profile: { connect: { id: data.profileId } } } : {}),
    };

    if (!Object.keys(updateData).length) {
      throw new BadRequestException('No fields to update');
    }

    const warningFields = ['profileId', 'jobTitle', 'company', 'location', 'workArrangement', 'jobDescription', 'jobUrl'] as const;
    if (warningFields.some((key) => data[key] !== undefined && data[key] !== app[key])) {
      const validation = await this.rulesService.validateApplication({
        profileId: data.profileId ?? app.profileId,
        jobTitle: data.jobTitle ?? app.jobTitle,
        company,
        location: data.location ?? app.location ?? undefined,
        workArrangement: data.workArrangement ?? app.workArrangement,
        jobDescription: data.jobDescription ?? app.jobDescription,
        excludeApplicationId: id,
        jobUrl: jobUrl ?? undefined,
      });
      updateData.warnings = { deleteMany: {}, create: validation.warnings };
    }

    return this.prisma.application.update({
      where: { id },
      data: updateData,
      include: {
        profile: { select: { id: true, firstName: true, lastName: true, profileTitle: true } },
        warnings: true,
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    if (isMaster(user.role)) {
      throw new ForbiddenException('Master accounts cannot delete applications');
    }
    await this.findOne(id, user);
    await this.storage.deleteResumeTree(id);
    await this.prisma.application.delete({ where: { id } });
    return { ok: true };
  }

  async updateStatus(id: string, status: ApplicationStatus, user: AuthUser, note?: string) {
    if (isMaster(user.role)) {
      throw new ForbiddenException('Master accounts cannot update applications');
    }
    const app = await this.findOne(id, user);

    const [updated] = await this.prisma.$transaction([
      this.prisma.application.update({
        where: { id },
        data: { status },
      }),
      this.prisma.applicationStatusHistory.create({
        data: {
          applicationId: id,
          fromStatus: app.status,
          toStatus: status,
          actorId: user.id,
          note,
        },
      }),
    ]);

    return updated;
  }

  async addNote(id: string, content: string, user: AuthUser) {
    if (isMaster(user.role)) {
      throw new ForbiddenException('Master accounts cannot modify applications');
    }
    await this.findOne(id, user);
    return this.prisma.applicationNote.create({
      data: { applicationId: id, authorId: user.id, content },
      include: { author: { select: { firstName: true, lastName: true } } },
    });
  }

  async acknowledgeWarning(warningId: string, user: AuthUser, reason?: string) {
    if (isMaster(user.role)) {
      throw new ForbiddenException('Master accounts cannot modify applications');
    }
    const warning = await this.prisma.applicationWarning.findUnique({ where: { id: warningId } });
    if (!warning) throw new NotFoundException('Warning not found');
    await this.findOne(warning.applicationId, user);
    return this.prisma.applicationWarning.update({
      where: { id: warningId },
      data: {
        acknowledgedAt: new Date(),
        overrideReason: reason,
        overriddenById: user.id,
      },
    });
  }
}
