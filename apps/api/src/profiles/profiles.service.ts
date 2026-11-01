import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/types/auth.types';
import { isStaff } from '../common/utils/roles.util';
import { profileAccessWhere } from '../common/utils/profile-access';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ProfilesService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  async findAll(user: AuthUser) {
    if (isStaff(user.role)) {
      const profiles = await this.prisma.profile.findMany({
        where: { archivedAt: null, ...profileAccessWhere(user) },
        include: {
          _count: { select: { assignments: true, applications: true } },
          assignments: {
            where: { userId: user.id, activeTo: null },
            select: { isDefault: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return profiles.map(({ assignments, ...profile }) => ({
        ...profile,
        isDefault: assignments.some((a) => a.isDefault),
      }));
    }

    const assignments = await this.prisma.profileAssignment.findMany({
      where: { userId: user.id, activeTo: null },
      include: { profile: true },
    });
    return assignments
      .map((a) => ({
        ...a.profile,
        isDefault: a.isDefault,
      }))
      .filter((p) => !p.archivedAt);
  }

  async findOne(id: string, user: AuthUser) {
    await this.checkAccess(id, user);
    return this.prisma.profile.findUnique({
      where: { id },
      include: {
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        skills: true,
        certifications: true,
        links: true,
      },
    });
  }

  async create(data: Record<string, unknown>, user: AuthUser) {
    if (!isStaff(user.role)) throw new ForbiddenException();
    const { experiences, education, skills, certifications, links, ...profileData } = data as {
      experiences?: unknown[];
      education?: unknown[];
      skills?: unknown[];
      certifications?: unknown[];
      links?: unknown[];
      [key: string]: unknown;
    };

    return this.prisma.profile.create({
      data: {
        ...this.editableData(profileData),
        ownerId: user.id,
        experiences: experiences ? { create: experiences as never[] } : undefined,
        education: education ? { create: education as never[] } : undefined,
        skills: skills ? { create: skills as never[] } : undefined,
        certifications: certifications ? { create: certifications as never[] } : undefined,
        links: links ? { create: links as never[] } : undefined,
      } as never,
      include: {
        experiences: true,
        education: true,
        skills: true,
        certifications: true,
        links: true,
      },
    });
  }

  async update(id: string, data: Record<string, unknown>, user: AuthUser) {
    if (!isStaff(user.role)) throw new ForbiddenException();
    await this.checkAccess(id, user);
    const { experiences, education, skills, certifications, links, ...profileData } = data as {
      experiences?: unknown[];
      education?: unknown[];
      skills?: unknown[];
      certifications?: unknown[];
      links?: unknown[];
      [key: string]: unknown;
    };

    return this.prisma.profile.update({
      where: { id },
      data: {
        ...this.editableData(profileData),
        experiences: experiences ? { deleteMany: {}, create: this.copyRows(experiences) } : undefined,
        education: education ? { deleteMany: {}, create: this.copyRows(education) } : undefined,
        skills: skills ? { deleteMany: {}, create: this.copyRows(skills) } : undefined,
        certifications: certifications ? { deleteMany: {}, create: this.copyRows(certifications) } : undefined,
        links: links ? { deleteMany: {}, create: this.copyRows(links) } : undefined,
      } as never,
      include: {
        experiences: true,
        education: true,
        skills: true,
        certifications: true,
        links: true,
      },
    });
  }

  async archive(id: string, user: AuthUser) {
    if (!isStaff(user.role)) throw new ForbiddenException();
    await this.checkAccess(id, user);
    return this.prisma.profile.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private editableData(data: Record<string, unknown>) {
    const fields = ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state', 'country',
      'profileTitle', 'summary', 'workAuthorization', 'remoteOnly', 'preferredRoles', 'defaultTemplateId', 'promptVersionId'];
    return Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  }

  private copyRows(rows: unknown[]): never[] {
    return rows.map((row) => {
      const { id: _id, profileId: _profileId, ...data } = row as Record<string, unknown>;
      return data;
    }) as never[];
  }

  async clone(id: string, user: AuthUser) {
    if (!isStaff(user.role)) throw new ForbiddenException();
    const original = await this.findOne(id, user);
    if (!original) throw new NotFoundException('Profile not found');

    const { id: _id, createdAt, updatedAt, archivedAt, ...data } = original;
    return this.create({
      ...data,
      firstName: `${data.firstName} (Copy)`,
      experiences: this.copyRows(original.experiences),
      education: this.copyRows(original.education),
      skills: this.copyRows(original.skills),
      certifications: this.copyRows(original.certifications),
      links: this.copyRows(original.links),
    }, user);
  }

  async getAssignedProfiles(user: AuthUser) {
    const assignments = await this.prisma.profileAssignment.findMany({
      where: { userId: user.id, activeTo: null, profile: { archivedAt: null, ...profileAccessWhere(user) } },
      include: { profile: true },
    });
    return assignments;
  }

  async getDefaultProfile(user: AuthUser) {
    const assignment = await this.prisma.profileAssignment.findFirst({
      where: { userId: user.id, isDefault: true, activeTo: null, profile: { archivedAt: null, ...profileAccessWhere(user) } },
      include: { profile: true },
    });
    return assignment?.profile || null;
  }

  async setDefaultProfile(profileId: string, user: AuthUser) {
    await this.checkAccess(profileId, user);

    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, archivedAt: null },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    await this.prisma.profileAssignment.updateMany({
      where: { userId: user.id, activeTo: null },
      data: { isDefault: false },
    });

    const existing = await this.prisma.profileAssignment.findUnique({
      where: { userId_profileId: { userId: user.id, profileId } },
    });

    if (existing) {
      await this.prisma.profileAssignment.update({
        where: { id: existing.id },
        data: { isDefault: true, activeTo: null },
      });
    } else {
      await this.prisma.profileAssignment.create({
        data: { userId: user.id, profileId, isDefault: true },
      });
    }

    return { success: true, profileId, isDefault: true };
  }

  async checkAccess(profileId: string, user: AuthUser) {
    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, ...profileAccessWhere(user) }, select: { id: true },
    });
    if (!profile) throw new ForbiddenException('Profile is not owned by or assigned to you');
  }

  async getProfilePromptAssignments(profileId: string, actor: AuthUser) {
    await this.checkAccess(profileId, actor);
    const profile = await this.prisma.profile.findFirst({ where: { id: profileId, archivedAt: null }, select: { id: true, firstName: true, lastName: true } });
    if (!profile) throw new NotFoundException('Profile not found');
    const preference = await this.settingsService.getProfileGenerationPreference(profileId, actor);
    const prompts = await this.settingsService.listAssignablePrompts(actor);
    return { mode: await this.settingsService.getPromptAssignmentMode(actor), profile: { ...profile, promptVersionId: preference.resumePromptId },
      prompts: prompts.map(prompt => ({ id: prompt.id, name: prompt.name, isInitial: false, ownerId: actor.id, ownerName: 'Me' })), bidders: [] };
  }

  async updateProfilePromptAssignments(profileId: string, assignments: { userId: string; promptVersionId: string | null }[], actor: AuthUser, profilePromptVersionId?: string | null) {
    await this.checkAccess(profileId, actor);
    if (assignments.some(row => row.userId !== actor.id)) throw new ForbiddenException('Prompts are private. Each user manages their own profile prompts in Settings.');
    const id = profilePromptVersionId !== undefined ? profilePromptVersionId : assignments.find(row => row.userId === actor.id)?.promptVersionId;
    if (id !== undefined) await this.settingsService.saveProfileGenerationPreference(profileId, actor, { resumePromptId: id });
    return this.getProfilePromptAssignments(profileId, actor);
  }

  buildProfileSnapshot(profile: NonNullable<Awaited<ReturnType<typeof this.findOne>>>) {
    return {
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      profileTitle: profile.profileTitle,
      summary: profile.summary,
      workAuthorization: profile.workAuthorization,
      experiences: profile.experiences,
      education: profile.education,
      skills: profile.skills,
      certifications: profile.certifications,
      links: profile.links,
    };
  }

  async getGenerationPreference(profileId: string, user: AuthUser) {
    await this.checkAccess(profileId, user);
    return this.settingsService.getProfileGenerationPreference(profileId, user);
  }

  async saveGenerationPreference(profileId: string, user: AuthUser, data: { resumePromptId?: string | null; coverLetterPromptId?: string | null }) {
    await this.checkAccess(profileId, user);
    return this.settingsService.saveProfileGenerationPreference(profileId, user, data);
  }
}
