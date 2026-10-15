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
      return Math.max(28, Math.min(120, Math.round(value)));
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
    const c = content as PreviewContent;
    const cfg = this.parseConfig(config);

    const primary = cfg.colors.primary;
    const heading = cfg.colors.heading;
    const body = cfg.colors.body;
    const accent = cfg.colors.accent;
    const divider = cfg.colors.divider;
    const sectionLabelBg = cfg.colors.sectionLabelBg;
    const sectionLabelText = cfg.colors.sectionLabelText;
    const contactColor = cfg.colors.contact || body;
    const muted = cfg.colors.muted || body;
    const bodyFont = cfg.typography.bodyFont || 'Georgia, serif';
    const headingFont = cfg.typography.headingFont || bodyFont;
    const fontSize = cfg.typography.baseFontSize;
    const headingScale = cfg.typography.headingScale;
    const lineHeight = cfg.typography.lineHeight;
    const letterSpacing = Math.max(0, Number(cfg.typography.letterSpacing) || 0);
    const nameUppercase = cfg.typography.nameUppercase;
    const headingUppercase = cfg.typography.headingUppercase;
    const { sectionSpacing, headerAlignment, pageSize, contactSeparator, nameContactGap } =
      cfg.layout;
    const { marginTop, marginBottom, marginLeft, marginRight } = this.pdfLayout(config);
    const {
      sectionHeadingStyle,
      listStyle,
      skillsLayout,
      experienceTitleWeight,
      locationItalic,
      showCertIssuer,
      showCertDate,
    } = cfg.styles;
    const contactCfg = cfg.contact;
    const headerAccent = cfg.pdf?.headerAccent || 'none';

    const isA4 = pageSize === 'A4';
    const pageWidth = isA4 ? '210mm' : '8.5in';
    const pageHeight = isA4 ? '297mm' : '11in';
    const visibility = cfg.sections.visibility;
    const order = cfg.sections.order?.length
      ? cfg.sections.order
      : ['summary', 'skills', 'experience', 'education', 'certifications'];

    const skills = skillRows(c.skills || []);
    const listCss =
      listStyle === 'none'
        ? 'list-style: none; padding-left: 0;'
        : listStyle === 'dash'
          ? 'list-style: none; padding-left: 14px;'
          : `list-style-type: ${listStyle}; padding-left: 18px;`;

    const liBefore =
      listStyle === 'dash'
        ? `li::before { content: "–"; position: absolute; left: 0; color: ${heading}; } li { position: relative; padding-left: 12px; }`
        : '';

    const rule = '';
    let h2Extra = '';
    if (sectionHeadingStyle === 'background') {
      h2Extra = `
        background: ${sectionLabelBg};
        color: ${sectionLabelText};
        padding: 4px 0;
      `;
    } else if (sectionHeadingStyle === 'bar') {
      h2Extra = `
        border: 0;
        padding-left: 10px;
        color: ${sectionLabelText || heading};
      `;
    }

    const renderSkills = () => {
      if (!skills.length || visibility.skills === false) return '';
      if (skillsLayout === 'bullets') {
        return `<section class="section"><h2>Technical Skills</h2>${rule}<ul>${skills
          .map((s) => `<li><span class="skill-cat">${this.esc(s.category)}:</span> ${this.esc(s.items)}</li>`)
          .join('')}</ul></section>`;
      }
      if (skillsLayout === 'lines') {
        return `<section class="section"><h2>Technical Skills</h2>${rule}${skills
          .map(
            (s) =>
              `<div class="skill-row"><span class="skill-cat">${this.esc(s.category)}</span><div>${this.esc(s.items)}</div></div>`,
          )
          .join('')}</section>`;
      }
      return `<section class="section"><h2>Technical Skills</h2>${rule}${skills
        .map(
          (s) =>
            `<div class="skill-row"><span class="skill-cat">${this.esc(s.category)}:</span> ${this.esc(s.items)}</div>`,
        )
        .join('')}</section>`;
    };

    const sectionHtml: Record<string, string> = {
      summary:
        c.summary && visibility.summary !== false
          ? `<section class="section"><h2>Professional Summary</h2>${rule}<p>${this.esc(c.summary)}</p></section>`
          : '',
      skills: renderSkills(),
      experience:
        c.experiences?.length && visibility.experience !== false
          ? `<section class="section"><h2>Professional Experience</h2>${rule}${c.experiences
              .map((e) => {
                const bullets = experienceBullets(e);
                const dates = experienceDates(e);
                const loc = plainText(e.location || e.companyLocation);
                return `<div class="exp"><div class="exp-header"><span class="exp-title">${this.esc(experienceTitle(e))} — ${this.esc(experienceCompany(e))}</span><span class="dates">${this.esc(dates)}</span></div>${
                  loc ? `<div class="exp-loc">${this.esc(loc)}</div>` : ''
                }${
                  bullets.length
                    ? `<ul>${bullets.map((b) => `<li>${this.esc(b)}</li>`).join('')}</ul>`
                    : ''
                }</div>`;
              })
              .join('')}</section>`
          : '',
      education:
        c.educations?.length && visibility.education !== false
          ? `<section class="section"><h2>Education</h2>${rule}${c.educations
              .map((e) => {
                const line = formatEducationLine(e);
                return line ? `<div class="edu">${this.esc(line)}</div>` : '';
              })
              .join('')}</section>`
          : '',
      certifications:
        c.certificates?.length && visibility.certifications !== false
          ? `<section class="section"><h2>Certifications</h2>${rule}${c.certificates
              .map((cert) => {
                const name = this.esc(String(cert.name || cert.title || '').trim());
                const issuer = showCertIssuer
                  ? this.esc(String(cert.issuer || cert.organization || '').trim())
                  : '';
                const date = showCertDate
                  ? this.esc(String(cert.date || cert.dates || cert.issueDate || '').trim())
                  : '';
                const line = [name, issuer].filter(Boolean).join(' — ');
                if (!line && !date) return '';
                return `<div class="cert"><span>${line || name}</span>${
                  date ? `<span class="dates">${date}</span>` : ''
                }</div>`;
              })
              .join('')}</section>`
          : '',
    };

    const sectionsBody = order.map((key) => sectionHtml[key] || '').join('');
    const h1Size = cfg.typography.nameSize ?? Math.round(fontSize * headingScale * 1.65);
    const h2Size = cfg.typography.headingSize ?? Math.round(fontSize * headingScale * 0.95);
    const contactFont = cfg.typography.contactSize ?? Math.max(8, fontSize - 1.5);
    const subtextFont = cfg.typography.subtextSize ?? Math.max(8, fontSize - 1);
    const contact = c.contact || { name: 'Candidate' };
    const headline = contactCfg.showJobTitle !== false ? resumeHeadline(c.experiences, contact.title) || '' : '';
    const separator = contactSeparator || '·';
    const contactParts = [
      contactCfg.showLocation !== false ? contact.address : '',
      contactCfg.showEmail !== false ? contact.email : '',
      contactCfg.showPhone !== false ? contact.phone : '',
      contactCfg.showLinkedin !== false ? contact.linkedin : '',
      ...(contact.links || []).filter(link => link.url !== contact.linkedin).map(link => link.url),
    ]
      .filter(Boolean)
      .map((part) => this.esc(part));
    const contactLine =
      contactCfg.layout === 'stacked'
        ? contactParts.join('<br/>')
        : contactParts.join(` ${this.esc(separator)} `);
    const accentClass =
      headerAccent === 'top-rule'
        ? ' accent-top-rule'
        : headerAccent === 'top-band'
          ? ' accent-top-band'
          : headerAccent === 'side'
            ? ' accent-side'
            : '';
    const pageSizeCss = isA4 ? 'A4' : 'Letter';

    const fontStack = this.cssFont(bodyFont);
    const headingStack = this.cssFont(headingFont);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: ${pageSizeCss}; margin: ${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .page {
        position: relative;
        width: ${pageWidth};
        margin: 0 auto;
        background: #fff;
        font-family: ${fontStack};
        font-size: ${fontSize}pt;
        line-height: ${lineHeight};
        letter-spacing: ${letterSpacing}px;
        color: ${body};
        overflow-wrap: break-word;
        word-wrap: break-word;
      }
      @media screen {
        .page {
          min-height: ${pageHeight};
          padding: ${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px;
        }
        .page-frame { position: absolute; inset: ${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px; }
        .sheet { padding: 16px; }
      }
      @media print {
        html, body, .page {
          width: auto;
          min-height: 0;
          margin: 0;
          padding: 0;
          background: #fff;
        }
        .page-frame { position: fixed; inset: 0; }
        .sheet { padding: 16px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
      }
      .page-frame { display: none; }
      .page.accent-side::before {
        content: "";
        position: absolute;
        top: ${marginTop + 4}px;
        bottom: ${marginBottom + 4}px;
        left: ${marginLeft + 4}px;
        width: 8px;
        background: ${accent};
        z-index: 2;
      }
      @media print {
        .page.accent-side::before { position: fixed; top: 4px; bottom: 4px; left: 4px; }
      }
      .top-band {
        display: block;
        width: 100%;
        height: 12px;
        background: ${accent};
        margin: 0 0 16px;
      }
      .sheet, .section, .header {
        display: block;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      .sheet { border: 0; }
      .header {
        text-align: ${headerAlignment};
        margin: 0 0 8px;
        padding: 0;
        border: 0;
      }
      .full-rule {
        display: block;
        width: 100%;
        height: 0;
        border: 0;
        border-top: 0;
        margin: 0 0 10px;
        clear: both;
        break-after: avoid;
      }
      .header-rule { margin: 0 0 ${sectionSpacing}px; }
      .page.accent-top-rule .header-rule {
        border-top: 0;
      }
      h1 {
        font-family: ${headingStack};
        color: ${primary};
        margin: 0;
        font-size: ${h1Size}pt;
        font-weight: 700;
        letter-spacing: 0;
        line-height: 1.15;
        text-transform: ${nameUppercase ? 'uppercase' : 'none'};
      }
      .headline {
        margin-top: ${nameContactGap}px;
        font-size: ${Math.max(fontSize, Math.round(fontSize * 1.05))}pt;
        font-weight: 600;
        color: ${heading};
        letter-spacing: 0;
      }
      h2 {
        display: block;
        width: 100%;
        box-sizing: border-box;
        font-family: ${headingStack};
        color: ${heading};
        font-size: ${h2Size}pt;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: ${headingUppercase !== false ? 'uppercase' : 'none'};
        border-bottom: 0;
        margin: 0 0 4px;
        break-after: avoid;
        page-break-after: avoid;
        ${h2Extra}
      }
      .section { margin-top: ${sectionSpacing}px; break-inside: auto; page-break-inside: auto; }
      .section:first-of-type { margin-top: 0; }
      .contact {
        font-size: ${contactFont}pt;
        color: ${contactColor};
        opacity: 0.9;
        margin-top: ${Math.max(2, Math.round(nameContactGap / 2))}px;
      }
      .skill-row { margin: 2px 0; }
      .skill-cat { font-weight: 700; color: ${heading}; }
      ul { margin: 3px 0 0; ${listCss} }
      li { margin: 1px 0; break-inside: avoid; orphans: 2; widows: 2; }
      ${liBefore}
      .exp { margin-bottom: 8px; break-inside: auto; page-break-inside: auto; }
      .exp-header {
        display: flex;
        justify-content: space-between;
        gap: 12px 16px;
        align-items: baseline;
        flex-wrap: wrap;
        break-after: avoid;
        page-break-after: avoid;
      }
      .exp-title {
        font-weight: ${experienceTitleWeight === 'normal' ? 400 : 700};
        color: ${heading};
        min-width: 0;
      }
      .exp-loc {
        font-size: ${subtextFont}pt;
        color: ${muted};
        font-style: ${locationItalic ? 'italic' : 'normal'};
        opacity: 0.9;
        margin: 1px 0 2px;
        break-after: avoid;
        page-break-after: avoid;
      }
      .dates {
        font-weight: 400;
        font-size: ${subtextFont}pt;
        color: ${muted};
        max-width: 100%;
        overflow-wrap: anywhere;
        font-style: ${locationItalic ? 'italic' : 'normal'};
      }
      .cert {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        break-inside: avoid;
        margin: 2px 0;
      }
      .edu-degree { font-weight: 700; color: ${heading}; }
      .edu-dates { opacity: 0.75; }
      p { margin: 0; orphans: 3; widows: 3; }
    </style></head><body>
        <div class="page${accentClass}">
        <div class="page-frame" aria-hidden="true"></div>
        ${headerAccent === 'top-band' ? '<div class="top-band"></div>' : ''}
        <div class="sheet">
        <div class="header">
          <h1>${this.esc(contact.name || 'Candidate Name')}</h1>
          ${headline ? `<div class="headline">${this.esc(headline)}</div>` : ''}
          <div class="contact">${contactLine}</div>
        </div>
        ${cfg.styles.showDividers || headerAccent === 'top-rule' ? '<div class="full-rule header-rule"></div>' : ''}
        ${sectionsBody}
        </div>
      </div>
    </body></html>`;
  }
}
