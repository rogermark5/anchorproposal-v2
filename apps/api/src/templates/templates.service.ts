import { renderResumeHtml } from './resume-html';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  templateConfigSchema,
  type TemplateConfig,
  skillRows,
  experienceBullets,
  experienceDates,
  experienceTitle,
  experienceCompany,
  formatEducationLine,
  plainText,
  type PromptResumeContent,
} from '@anchorproposal/shared';
import { AuthUser } from '../common/types/auth.types';
import { isStaff } from '../common/utils/roles.util';
import { UserRole } from '@prisma/client';
import { resumeHeadline } from '../common/utils/resume-headline';

export type PreviewContent = PromptResumeContent;

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  getSamplePreviewContent(): PreviewContent {
    return {
      contact: {
        name: 'Alexandra Chen',
        title: 'Senior Product Manager',
        address: 'San Francisco, CA',
        email: 'alexandra.chen@email.com',
        phone: '(415) 555-0123',
        linkedin: 'linkedin.com/in/alexandrachen',
      },
      summary:
        'Strategic product manager with 8+ years driving innovation at high-growth SaaS companies. Expert in translating customer insights into product roadmaps.',
      skills: [
        {
          'Product Strategy': 'Roadmap Planning, Market Analysis, Competitive Intelligence',
        },
        { Technical: 'SQL, Python, Jira, Figma, A/B Testing, APIs' },
      ],
      experiences: [
        {
          title: 'Senior Product Manager',
          company: 'Stripe',
          location: 'San Francisco, CA',
          dates: 'Mar 2021 – Present',
          jobType:'Full time',
          bullets: [
            'Spearheaded the launch of a new billing platform that generated $8M in incremental revenue.',
            'Led a cross-functional team of 12 engineers, 3 designers, and 2 data scientists.',
          ],
        },
        {
          title: 'Product Manager',
          company: 'Salesforce',
          location: 'San Francisco, CA',
          dates: 'Jan 2018 – Feb 2021',
          jobType:'Full time',
          bullets: [
            'Owned the end-to-end product lifecycle for the Einstein Analytics mobile app.',
          ],
        },
      ],
      educations: [
        {
          institution: 'Stanford Graduate School of Business',
          degree: 'Master of Business Administration',
          dates: '2014 – 2016',
        },
        {
          institution: 'University of Washington',
          degree: 'Bachelor of Science in Computer Science',
          dates: '2010 – 2014',
        },
      ],
      certificates: [
        { name: 'Certified Scrum Product Owner (CSPO)', issuer: 'Scrum Alliance', date: '2022' },
        { name: 'Google Analytics Individual Qualification', issuer: 'Google', date: '2023' },
      ],
      headline:'Product leader building dependable platforms and exceptional customer experiences.',
      coreExpertise:['Product strategy','Cross-functional leadership','Platform delivery','Customer research'],
      projects:[{name:'Customer Insights Platform',description:'A self-service analytics workspace for product and customer-success teams.',technologies:'SQL, Python, React',url:'https://example.com/projects/insights',dates:'2024',bullets:['Unified product analytics into one accessible workspace.']}],
    };
  }

  async findAllForUser(user: AuthUser) {
    if (isStaff(user.role)) {
      const [templates, assignments] = await Promise.all([
        this.prisma.templateVersion.findMany({
          where: { archivedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.templateAssignment.findMany({
          where: { userId: user.id, activeTo: null },
          select: { templateVersionId: true, isDefault: true },
        }),
      ]);
      const defaultById = new Map(
        assignments.map((a) => [a.templateVersionId, a.isDefault] as const),
      );
      return Promise.all(templates.map(async (t) => ({
        ...t,
        ...await this.personalConfig(t, user),
        isDefault: defaultById.get(t.id) === true,
      })));
    }

    const assignments = await this.prisma.templateAssignment.findMany({
      where: { userId: user.id, activeTo: null },
      include: {
        templateVersion: true,
      },
    });

    const list = assignments
      .filter((a) => a.templateVersion.isPublished && !a.templateVersion.archivedAt)
      .map((a) => ({
        ...a.templateVersion,
        isDefault: a.isDefault,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.all(list.map(async template => ({ ...template, ...await this.personalConfig(template, user) })));
  }

  /** @deprecated Prefer findAllForUser */
  async findAll(publishedOnly = false) {
    return this.prisma.templateVersion.findMany({
      where: {
        archivedAt: null,
        ...(publishedOnly ? { isPublished: true } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async checkAccess(templateVersionId: string, user: AuthUser) {
    const template = await this.prisma.templateVersion.findUnique({ where: { id: templateVersionId } });
    if (!template || template.archivedAt) {
      throw new NotFoundException('Template not found');
    }
    if (isStaff(user.role)) return this.personalConfig(template, user);

    if (!template.isPublished) {
      throw new ForbiddenException('Bidders may only use published templates');
    }
    const assignment = await this.prisma.templateAssignment.findFirst({
      where: { userId: user.id, templateVersionId, activeTo: null },
    });
    if (!assignment) {
      throw new ForbiddenException('Template is not assigned to you');
    }
    return this.personalConfig(template, user);
  }

  private async personalConfig<T extends { id: string; name: string; configJson: unknown }>(template: T, user: AuthUser) {
    const custom = await this.prisma.userTemplateCustomization.findUnique({ where: { userId_templateVersionId: { userId: user.id, templateVersionId: template.id } } });
    return { ...template, ...(custom ? { name: custom.name || template.name, configJson: custom.configJson } : {}), customized: Boolean(custom) };
  }

  async customize(id: string, user: AuthUser, data: { name?: string; configJson?: object }) {
    const template = await this.checkAccess(id, user);
    if (!template.isPublished) throw new BadRequestException('Choose a published default template before customizing it.');
    const configJson = templateConfigSchema.parse(data.configJson ?? template.configJson);
    const name = data.name?.trim() || template.name;
    await this.prisma.userTemplateCustomization.upsert({
      where: { userId_templateVersionId: { userId: user.id, templateVersionId: id } },
      create: { userId: user.id, templateVersionId: id, name, configJson }, update: { name, configJson },
    });
    await this.setDefaultTemplate(id, user);
    return this.checkAccess(id, user);
  }

  async resolveDefaultTemplateId(user: AuthUser): Promise<string | undefined> {
    if (user.role === UserRole.BIDDER || isStaff(user.role)) {
      const assignments = await this.prisma.templateAssignment.findMany({
        where: { userId: user.id, activeTo: null },
        include: {
          templateVersion: { select: { id: true, isPublished: true, archivedAt: true } },
        },
        orderBy: { activeFrom: 'asc' },
      });
      const usable = assignments.filter(
        (a) => a.templateVersion.isPublished && !a.templateVersion.archivedAt,
      );
      const preferred = usable.find((a) => a.isDefault) || usable[0];
      if (preferred) return preferred.templateVersionId;
      if (user.role === UserRole.BIDDER) return undefined;
    }

    const defaultTemplate = await this.prisma.templateVersion.findFirst({
      where: { isPublished: true, archivedAt: null },
      orderBy: { publishedAt: 'desc' },
    });
    return defaultTemplate?.id;
  }

  async setDefaultTemplate(templateVersionId: string, user: AuthUser) {
    const template = await this.checkAccess(templateVersionId, user);
    if (!template || template.archivedAt) {
      throw new NotFoundException('Template not found');
    }
    if (!template.isPublished) {
      throw new BadRequestException('Only published templates can be set as default');
    }

    await this.prisma.templateAssignment.updateMany({
      where: { userId: user.id, activeTo: null },
      data: { isDefault: false },
    });

    const existing = await this.prisma.templateAssignment.findUnique({
      where: {
        userId_templateVersionId: { userId: user.id, templateVersionId },
      },
    });

    if (existing) {
      await this.prisma.templateAssignment.update({
        where: { id: existing.id },
        data: { isDefault: true, activeTo: null },
      });
    } else {
      await this.prisma.templateAssignment.create({
        data: { userId: user.id, templateVersionId, isDefault: true },
      });
    }

    return { success: true, templateId: templateVersionId, isDefault: true };
  }

  async findOne(id: string) {
    const template = await this.prisma.templateVersion.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async create(data: { name: string; preset?: string; configJson?: object }) {
    return this.prisma.templateVersion.create({
      data: {
        name: data.name,
        preset: data.preset,
        configJson: data.configJson || templateConfigSchema.parse({}),
      },
    });
  }

  async update(id: string, data: { name?: string; configJson?: object }) {
    return this.prisma.templateVersion.update({ where: { id }, data });
  }

  async publish(id: string) {
    return this.prisma.templateVersion.update({
      where: { id },
      data: { isPublished: true, publishedAt: new Date() },
    });
  }

  async clone(id: string) {
    const original = await this.findOne(id);
    return this.create({
      name: `${original.name} (Copy)`,
      preset: original.preset || undefined,
      configJson: original.configJson as object,
    });
  }

  async archive(id: string) {
    await this.findOne(id);
    return this.prisma.templateVersion.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private parseConfig(config: object): TemplateConfig {
    const parsed = templateConfigSchema.safeParse(config ?? {});
    if (parsed.success) return parsed.data;
    return templateConfigSchema.parse({});
  }

  private esc(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private cssFont(name: string): string {
    const clean = String(name || 'Georgia').replace(/["\\;{}]/g, '').trim() || 'Georgia';
    const serif = /georgia|garamond|times|cambria|baskerville|palatino/i.test(clean);
    return `"${clean}", ${serif ? '"Times New Roman", Times, serif' : 'Arial, Helvetica, sans-serif'}`;
  }

  /** Margins stay large enough that glyphs are not clipped at the page edge. */
  pdfLayout(config: object) {
    const cfg = this.parseConfig(config);
    const clamp = (n: number, fallback: number) => {
      const value = Number.isFinite(n) ? n : fallback;
      return Math.max(28, Math.min(120, value));
    };
    return {
      pageSize: cfg.layout.pageSize,
      marginTop: clamp(cfg.layout.marginTop, 36),
      marginBottom: clamp(cfg.layout.marginBottom, 36),
      marginLeft: clamp(cfg.layout.marginLeft, 48),
      marginRight: clamp(cfg.layout.marginRight, 48),
    };
  }

  renderPreviewHtml(content: object, config: object): string {
    return renderResumeHtml(content, config);
  }
}
