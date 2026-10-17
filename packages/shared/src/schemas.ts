import { z } from 'zod';
import { HEADER_ACCENTS, WATERMARKS, SECTION_STYLES } from './template-design';

/** Skill row: { "Frontend Development": "React, TypeScript, ..." } */
export const promptSkillRowSchema = z.record(z.string());

export const promptContactSchema = z.object({
  name: z.string(),
  /** Professional headline shown under the name (e.g. target or current role). */
  title: z.string().optional(),
  address: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedin: z.string().optional(),
  links: z.array(z.object({ type: z.string(), url: z.string() })).optional(),
});

/** Flexible experience row matching prompt / profile field names. */
export const promptExperienceSchema = z
  .object({
    title: z.string().nullish(),
    jobTitle: z.string().nullish(),
    company: z.string().nullish(),
    companyName: z.string().nullish(),
    location: z.string().nullish(),
    companyLocation: z.string().nullish(),
    dates: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    enterDate: z.string().nullish(),
    bullets: z.array(z.string()).nullish(),
    responsibilities: z.union([z.string(), z.array(z.string())]).nullish(),
    achievements: z.union([z.string(), z.array(z.string())]).nullish(),
    technologies: z.string().nullish(),
    jobType: z.string().nullish(),
  })
  .passthrough();

export const promptEducationSchema = z
  .object({
    institution: z.string().nullish(),
    school: z.string().nullish(),
    university: z.string().nullish(),
    degree: z.string().nullish(),
    major: z.string().nullish(),
    dates: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    location: z.string().nullish(),
  })
  .passthrough();

export const promptCertificateSchema = z
  .object({
    name: z.string().nullish(),
    title: z.string().nullish(),
    issuer: z.string().nullish(),
    organization: z.string().nullish(),
    date: z.string().nullish(),
    dates: z.string().nullish(),
    issueDate: z.string().nullish(),
  })
  .passthrough();

/**
 * Canonical resume JSON used by prompts and document rendering.
 * Matches Admin prompt OUTPUT FORMAT (contact / skills / experiences / …).
 */
export const promptResumeSchema = z.object({
  contact: promptContactSchema,
  summary: z.string(),
  skills: z.array(promptSkillRowSchema).default([]),
  // Accept any object rows — AI/profile payloads vary; renderer reads known fields.
  experiences: z.array(z.record(z.any())).default([]),
  educations: z.array(z.record(z.any())).default([]),
  certificates: z.array(z.record(z.any())).default([]),
  projects: z.array(z.record(z.any())).optional(),
  headline: z.string().optional(),
  coreExpertise: z.array(z.string()).optional(),
});

export type PromptResumeContent = z.infer<typeof promptResumeSchema>;

/** @deprecated Use PromptResumeContent */
export type ResumeContent = PromptResumeContent;

export const coverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()).min(1),
  closing: z.string(),
  signatureName: z.string().optional(),
});

export type CoverLetterContent = z.infer<typeof coverLetterSchema>;

export const generationOutputSchema = z.object({
  contact: promptContactSchema,
  summary: z.string(),
  skills: z.array(promptSkillRowSchema).default([]),
  experiences: z.array(z.record(z.any())).default([]),
  educations: z.array(z.record(z.any())).default([]),
  certificates: z.array(z.record(z.any())).default([]),
  // Optional sections are supplied by the authenticated document editor.
  projects: z.array(z.record(z.any())).optional(),
  headline: z.string().optional(),
  coreExpertise: z.array(z.string()).optional(),
  coverLetter: coverLetterSchema.optional(),
});

export type GenerationOutput = z.infer<typeof generationOutputSchema>;

const editedText = z.string().trim().max(6000);
export const documentEditsSchema = z.object({
  summary: z.string().trim().min(1, 'Enter a professional summary.').max(12000),
  skills: z.array(z.record(z.string().trim().min(1, 'Enter a skill category.').max(150), editedText)).max(60),
  experiences: z.array(z.object({ title: z.string().trim().min(1, 'Enter a position for each experience.').max(300), bullets: z.array(editedText.min(1)).min(1, 'Enter at least one bullet for each experience.').max(80) }).strict()).max(100),
  educations: z.array(z.object({ degree: editedText, institution: editedText, dates: editedText, location: editedText.optional() }).strict().refine(row => row.degree || row.institution, 'Enter a degree or institution, or remove the empty education entry.')).max(50),
  certificates: z.array(z.object({ name: editedText.min(1, 'Enter a certification name.'), issuer: editedText, date: editedText }).strict()).max(100),
  projects: z.array(z.object({name:editedText.min(1,'Enter a project name.'),description:editedText,technologies:editedText,url:z.string().trim().max(2000).refine(value=>{if(!value)return true;try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!!url.hostname;}catch{return false;}},'Use a valid HTTP or HTTPS project URL.'),dates:editedText,bullets:z.array(editedText.min(1)).max(40)}).strict()).max(30).optional(),
  headline: z.string().trim().max(500).optional(),
  coreExpertise: z.array(z.string().trim().min(1).max(200)).max(60).optional(),
  coverLetter: z.object({ greeting: editedText.min(1, 'Enter a cover letter greeting.'), paragraphs: z.array(editedText.min(1)).min(1, 'Enter cover letter paragraph text.').max(30), closing: editedText.min(1, 'Enter a cover letter closing.') }).strict().optional(),
  idempotencyKey: z.string().min(16).max(150).optional(),
}).strict();

const OBJECT_TEXT_KEYS = [
  'text',
  'description',
  'content',
  'name',
  'title',
  'value',
  'bullet',
  'responsibility',
  'achievement',
  'degree',
  'major',
  'label',
] as const;

/** Coerce AI/profile nested values to display text; never returns "[object Object]". */
export function plainText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '[object Object]' ? '' : t;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(plainText).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    for (const key of OBJECT_TEXT_KEYS) {
      const got = plainText(rec[key]);
      if (got) return got;
    }
    for (const v of Object.values(rec)) {
      const got = plainText(v);
      if (got) return got;
    }
  }
  return '';
}

/** Always returns a string list (unwraps nested bullet objects / newline strings). */
export function plainTextList(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t || t === '[object Object]') return [];
    return t
      .split(/\n+/)
      .map((s) => s.replace(/^[-•*]\s*/, '').trim())
      .filter((s) => s && s !== '[object Object]');
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => plainTextList(item)).filter(Boolean);
  }
  const single = plainText(value);
  return single ? [single] : [];
}

function firstPlain(
  rec: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const got = plainText(rec[key]);
    if (got) return got;
  }
  return '';
}

export function experienceBullets(
  exp: Record<string, unknown> | z.infer<typeof promptExperienceSchema>,
): string[] {
  const e = exp as Record<string, unknown>;
  for (const key of ['bullets', 'responsibilities', 'achievements', 'highlights', 'duties', 'description', 'details']) {
    const list = plainTextList(e[key]);
    if (list.length) return list;
  }
  return [];
}

export function experienceDates(
  exp: Record<string, unknown> | z.infer<typeof promptExperienceSchema>,
): string {
  const e = exp as Record<string, unknown>;
  const dates = plainText(e.dates);
  if (dates) return dates;
  const start = plainText(e.enterDate || e.startDate);
  const end = plainText(e.endDate) || (start ? 'Present' : '');
  if (start || plainText(e.endDate)) return `${start} – ${end}`.replace(/^\s–\s/, '').trim();
  return '';
}

export function experienceTitle(
  exp: Record<string, unknown> | z.infer<typeof promptExperienceSchema>,
): string {
  const e = exp as Record<string, unknown>;
  return firstPlain(e, ['title', 'jobTitle', 'position', 'role']) || 'Role';
}

export function experienceCompany(
  exp: Record<string, unknown> | z.infer<typeof promptExperienceSchema>,
): string {
  const e = exp as Record<string, unknown>;
  return firstPlain(e, ['company', 'companyName', 'employer', 'organization', 'org']) || 'Company';
}

export function formatEducationLine(
  edu: Record<string, unknown> | z.infer<typeof promptEducationSchema>,
): string {
  const e = edu as Record<string, unknown>;
  const degree = firstPlain(e, ['degree', 'major', 'name', 'title']);
  const institution = firstPlain(e, ['institution', 'school', 'university']);
  const dates =
    plainText(e.dates) ||
    [plainText(e.startDate), plainText(e.endDate)].filter(Boolean).join(' – ');
  return `${degree}${institution ? ` — ${institution}` : ''}${dates ? ` (${dates})` : ''}`.trim();
}

export function formatCertificateLine(
  cert: Record<string, unknown> | z.infer<typeof promptCertificateSchema>,
): string {
  const c = cert as Record<string, unknown>;
  const name = firstPlain(c, ['name', 'title']);
  const issuer = firstPlain(c, ['issuer', 'organization', 'org']);
  const date = firstPlain(c, ['date', 'dates', 'issueDate']);
  return `${name}${issuer ? ` — ${issuer}` : ''}${date ? ` (${date})` : ''}`.trim();
}

export function skillRows(
  skills: z.infer<typeof promptSkillRowSchema>[],
): { category: string; items: string }[] {
  return skills.flatMap((row) =>
    Object.entries(row).map(([category, items]) => ({
      category: plainText(category) || category,
      items: plainText(items),
    })),
  );
}

const designColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex color, such as #1e3a5f.');
const designElement = z.object({visible:z.boolean().optional(),line:z.union([z.literal(1),z.literal(2)]).optional(),align:z.enum(['left','center','right']).optional(),bold:z.boolean().optional(),italic:z.boolean().optional(),color:designColor.optional()});
const entryDesign = z.object({layout:z.enum(['single','double']).default('double'),lineGap:z.number().min(0).max(720).default(40),bulletGap:z.number().min(0).max(720).default(60),separator:z.string().max(12).default('•'),elements:z.record(z.string(),designElement).default({})});
export const templateConfigSchema = z.object({
  typography: z
    .object({
      bodyFont: z.string().default('Inter'),
      headingFont: z.string().default('Inter'),
      baseFontSize: z.number().default(11),
      headingScale: z.number().default(1.2),
      lineHeight: z.number().default(1.4),
      letterSpacing: z.number().default(0),
      nameUppercase: z.boolean().default(false),
      headingUppercase: z.boolean().default(true),
      nameSize: z.number().optional(),
      headingSize: z.number().optional(),
      contactSize: z.number().optional(),
      subtextSize: z.number().optional(),
    })
    .default({}),
  layout: z
    .object({
      pageSize: z.enum(['A4', 'LETTER']).default('LETTER'),
      marginTop: z.number().default(36),
      marginBottom: z.number().default(36),
      marginLeft: z.number().default(48),
      marginRight: z.number().default(48),
      sectionSpacing: z.number().default(16),
      headerAlignment: z.enum(['left', 'center', 'right']).default('left'),
      contactSeparator: z.string().default('·'),
      nameContactGap: z.number().default(6),
    })
    .default({}),
  colors: z
    .object({
      primary: z.string().default('#1e3a5f'),
      heading: z.string().default('#1e293b'),
      body: z.string().default('#334155'),
      accent: z.string().default('#3b82f6'),
      divider: z.string().default('#e2e8f0'),
      sectionLabelBg: z.string().default('#e8eef5'),
      sectionLabelText: z.string().default('#1e293b'),
      contact: z.string().optional(),
      muted: z.string().optional(),
    })
    .default({}),
  contact: z
    .object({
      showJobTitle: z.boolean().default(true),
      layout: z.enum(['single', 'stacked']).default('single'),
      showEmail: z.boolean().default(true),
      showPhone: z.boolean().default(true),
      showLocation: z.boolean().default(true),
      showLinkedin: z.boolean().default(true),
      elements: z.record(z.string(),designElement).default({}),
    })
    .default({}),
  pdf: z
    .object({
      headerAccent: z.enum(HEADER_ACCENTS).default('none'),
      watermark: z.enum(WATERMARKS).default('none'),
      sectionStyle: z.enum(SECTION_STYLES).optional(),
      theme: z.string().max(60).optional(),
      watermarkOpacity:z.number().min(.02).max(.3).default(.12),
    })
    .default({}),
  styles: z
    .object({
      sectionHeadingStyle: z
        .enum(['underline', 'background', 'bar', 'plain'])
        .default('underline'),
      listStyle: z.enum(['disc', 'circle', 'square', 'dash', 'none']).default('disc'),
      skillsLayout: z.enum(['comma', 'bullets', 'lines']).default('comma'),
      showDividers: z.boolean().default(true),
      experienceTitleWeight: z.enum(['normal', 'bold']).default('bold'),
      locationItalic: z.boolean().default(false),
      showCertIssuer: z.boolean().default(true),
      showCertDate: z.boolean().default(true),
      headingLineStyle:z.enum(['none','full','short','double']).default('none'),
      headingLineColor:designColor.optional(),
      headingLineThickness:z.number().min(1).max(32).default(8),
      headingLineSpacing:z.number().min(0).max(720).default(60),
    })
    .default({}),
  sections: z
    .object({
      order: z
        .array(z.string())
        .default(['summary', 'skills', 'experience', 'education', 'certifications']),
      visibility: z.record(z.string(), z.boolean()).default({
        summary: true,
        skills: true,
        experience: true,
        education: true,
        certifications: true,
      }),
      labels:z.record(z.string(),z.string().trim().max(100)).default({}),
      headingAlignment:z.enum(['left','center','right']).default('left'),
    })
    .default({}),
  experience:entryDesign.optional(),
  education:entryDesign.optional(),
  certifications:entryDesign.optional(),
  headline:z.object({fontSize:z.number().min(6).max(36).optional(),topGap:z.number().min(0).max(1440).default(0),bottomGap:z.number().min(0).max(1440).default(120),color:designColor.optional(),bold:z.boolean().default(false),italic:z.boolean().default(true),alignment:z.enum(['left','center','right']).default('left')}).default({}),
  expertise:z.object({layout:z.enum(['inline','bullets','grid']).default('inline'),columns:z.number().int().min(2).max(4).default(2)}).default({}),
  projects:entryDesign.optional(),
  meta: z
    .object({
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional()
    .default({}),
});

export type TemplateConfig = z.infer<typeof templateConfigSchema>;
