import { homedir } from 'os';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import {
  experienceBullets,
  experienceCompany,
  experienceDates,
  experienceTitle,
  formatEducationLine,
  skillRows,
  templateConfigSchema,
  type PromptResumeContent,
} from '@anchorproposal/shared';
import { TemplatesService } from '../templates/templates.service';
import { StorageService } from '../storage/storage.service';
import { coverLetterContactLines, coverLetterDate, renderCoverLetterHtml } from './cover-letter-layout';
import { usableCoverLetter } from '../deepseek/cover-letter';
import { resumeHeadline } from '../common/utils/resume-headline';
import * as puppeteer from 'puppeteer';
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, PageBorderOffsetFrom } from 'docx';

/** Puppeteer reads its cache directory once, at import time. */
function chromeExecutablePath(): string {
  const configured = process.env.PUPPETEER_CACHE_DIR || '';
  const stableCache = join(homedir(), '.cache', 'puppeteer');
  if (!configured || configured.includes('cursor-sandbox-cache')) {
    const instance =
      (puppeteer as { default?: { configuration?: { cacheDirectory?: string } } }).default ??
      (puppeteer as { configuration?: { cacheDirectory?: string } });
    if (instance.configuration) instance.configuration.cacheDirectory = stableCache;
  }
  return puppeteer.executablePath();
}

@Injectable()
export class DocumentRendererService {
  constructor(
    private templatesService: TemplatesService,
    private storage: StorageService,
  ) {}

  async renderPdf(html: string, templateConfig: object = {}, existingBrowser?: puppeteer.Browser): Promise<Buffer> {
    const box = this.templatesService.pdfLayout(templateConfig);
    const browser = existingBrowser || await puppeteer.launch({
      headless: true,
      timeout: 60_000,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      executablePath: chromeExecutablePath(),
    });
    let page: puppeteer.Page | undefined;
    try {
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMediaType('print');
      const pdf = await page.pdf({
        format: box.pageSize === 'A4' ? 'A4' : 'Letter',
        printBackground: true,
        timeout: 60_000,
        preferCSSPageSize: false,
        margin: {
          top: `${box.marginTop}px`,
          right: `${box.marginRight}px`,
          bottom: `${box.marginBottom}px`,
          left: `${box.marginLeft}px`,
        },
      });
      return Buffer.from(pdf);
    } finally {
      if (existingBrowser) await page?.close();
      else await browser.close();
    }
  }

  async renderDocx(content: PromptResumeContent, templateConfig: object = {}): Promise<Buffer> {
    const cfg = templateConfigSchema.parse(templateConfig) as {
      colors?: { primary?: string; heading?: string; body?: string; muted?: string; divider?: string; sectionLabelBg?: string; sectionLabelText?: string };
      typography?: {
        bodyFont?: string;
        headingFont?: string;
        baseFontSize?: number;
        nameSize?: number;
        headingSize?: number;
        contactSize?: number;
        nameUppercase?: boolean;
        headingUppercase?: boolean;
      };
      contact?: {
        layout?: string;
        showEmail?: boolean;
        showPhone?: boolean;
        showLocation?: boolean;
        showLinkedin?: boolean;
      };
      layout?: { sectionSpacing?: number; contactSeparator?: string };
      styles?: { sectionHeadingStyle?: string; showDividers?: boolean; experienceTitleWeight?: string; locationItalic?: boolean; showCertIssuer?: boolean; showCertDate?: boolean; listStyle?: string };
      sections?: { order?: string[]; visibility?: Record<string, boolean> };
    };
    const box = this.templatesService.pdfLayout(templateConfig);
    const hex = (value: string | undefined, fallback: string) =>
      (value || fallback).replace('#', '');
    const primary = hex(cfg.colors?.primary, '1e3a5f');
    const heading = hex(cfg.colors?.heading, '1e293b');
    const body = hex(cfg.colors?.body, '334155');
    const muted = hex(cfg.colors?.muted, '64748b');
    const font = cfg.typography?.bodyFont || 'Georgia';
    const headingFont = cfg.typography?.headingFont || font;
    const bodySize = Math.round((cfg.typography?.baseFontSize || 11) * 2);
    const nameSize = Math.round((cfg.typography?.nameSize || 20) * 2);
    const headingSize = Math.round((cfg.typography?.headingSize || 12) * 2);
    const contactSize = Math.round((cfg.typography?.contactSize || 9) * 2);
    const headingUpper = cfg.typography?.headingUppercase !== false;
    const align =
      (templateConfig as { layout?: { headerAlignment?: string } }).layout?.headerAlignment === 'center'
        ? AlignmentType.CENTER
        : AlignmentType.LEFT;
    const contact = { ...content.contact, title: resumeHeadline(content.experiences, content.contact?.title) };
    const visibility = cfg.sections?.visibility || {};
    const order = cfg.sections?.order?.length
      ? cfg.sections.order
      : ['summary', 'skills', 'experience', 'education', 'certifications'];

    const headingPara = (text: string) =>
      new Paragraph({
        keepNext: true,
        spacing: { before: Math.round((cfg.layout?.sectionSpacing ?? 16) * 15), after: 80 },
        ...(cfg.styles?.sectionHeadingStyle === 'background'
          ? { shading: { fill: hex(cfg.colors?.sectionLabelBg, 'f1f5f9') } } : {}),
        children: [
          new TextRun({
            text: headingUpper ? text.toUpperCase() : text,
            bold: true,
            font: headingFont,
            size: headingSize,
            color: cfg.styles?.sectionHeadingStyle === 'background' ? hex(cfg.colors?.sectionLabelText, '1e293b') : heading,
          }),
        ],
      });

    const children: Paragraph[] = [
      new Paragraph({
        alignment: align,
        children: [
          new TextRun({
            text: cfg.typography?.nameUppercase ? (contact.name || '').toUpperCase() : contact.name || 'Candidate',
            bold: true,
            font: headingFont,
            size: nameSize,
            color: primary,
          }),
        ],
      }),
    ];
    if (contact.title) {
      children.push(
        new Paragraph({
          alignment: align,
          children: [
            new TextRun({ text: contact.title, bold: true, font, size: bodySize, color: heading }),
          ],
        }),
      );
    }
    const contactLine = [
      cfg.contact?.showLocation !== false ? contact.address : '',
      cfg.contact?.showEmail !== false ? contact.email : '',
      cfg.contact?.showPhone !== false ? contact.phone : '',
      cfg.contact?.showLinkedin !== false ? contact.linkedin : '',
      ...(contact.links || []).filter(link => link.url !== contact.linkedin).map(link => link.url),
    ]
      .filter(Boolean)
      .join(` ${cfg.layout?.contactSeparator || '·'} `);
    if (contactLine) {
      const contactParts = contactLine.split(` ${cfg.layout?.contactSeparator || '·'} `);
      children.push(
        new Paragraph({
          alignment: align,
          spacing: { after: 160 },
          children: cfg.contact?.layout === 'stacked'
            ? contactParts.map((text, index) => new TextRun({ text, break: index ? 1 : undefined, font, size: contactSize, color: muted }))
            : [new TextRun({ text: contactLine, font, size: contactSize, color: muted })],
        }),
      );
    }

    const blocks: Record<string, Paragraph[]> = {
      summary:
        content.summary && visibility.summary !== false
          ? [headingPara('Professional Summary'), new Paragraph({ children: [new TextRun({ text: content.summary, font, size: bodySize, color: body })] })]
          : [],
      skills:
        skillRows(content.skills || []).length && visibility.skills !== false
          ? [
              headingPara('Technical Skills'),
              ...skillRows(content.skills || []).map(
                (group) =>
                  new Paragraph({
                    children: [
                      new TextRun({ text: `${group.category}: `, bold: true, font, size: bodySize, color: heading }),
                      new TextRun({ text: group.items, font, size: bodySize, color: body }),
                    ],
                  }),
              ),
            ]
          : [],
      experience:
        content.experiences?.length && visibility.experience !== false
          ? [
              headingPara('Professional Experience'),
              ...content.experiences.flatMap((exp) => [
                new Paragraph({
                  keepNext: true,
                  children: [
                    new TextRun({
                      text: `${experienceTitle(exp)} — ${experienceCompany(exp)}`,
                      bold: cfg.styles?.experienceTitleWeight !== 'normal',
                      font,
                      size: bodySize,
                      color: heading,
                    }),
                    new TextRun({
                      text: `  ${experienceDates(exp)}`,
                      font,
                      size: contactSize,
                      color: muted,
                    }),
                  ],
                }),
                ...(exp.location || exp.companyLocation ? [new Paragraph({
                  keepNext: true,
                  children: [new TextRun({ text: String(exp.location || exp.companyLocation), italics: Boolean(cfg.styles?.locationItalic), font, size: contactSize, color: muted })],
                })] : []),
                ...experienceBullets(exp).map(
                  (bullet) =>
                    new Paragraph({
                      keepLines: true,
                      ...(cfg.styles?.listStyle === 'none' || cfg.styles?.listStyle === 'dash' ? {} : { bullet: { level: 0 } }),
                      children: [new TextRun({ text: cfg.styles?.listStyle === 'dash' ? `- ${bullet}` : bullet, font, size: bodySize, color: body })],
                    }),
                ),
              ]),
            ]
          : [],
      education:
        content.educations?.length && visibility.education !== false
          ? [
              headingPara('Education'),
              ...content.educations.flatMap((edu) => {
                const line = formatEducationLine(edu);
                return line
                  ? [new Paragraph({ children: [new TextRun({ text: line, bold: true, font, size: bodySize, color: heading })] })]
                  : [];
              }),
            ]
          : [],
      certifications:
        content.certificates?.length && visibility.certifications !== false
          ? [
              headingPara('Certifications'),
              ...content.certificates.flatMap((cert) => {
                const record = cert as Record<string, unknown>;
                const name = String(record.name || record.title || '').trim();
                const issuer =
                  cfg.styles?.showCertIssuer !== false
                    ? String(record.issuer || record.organization || '').trim()
                    : '';
                const date =
                  cfg.styles?.showCertDate !== false
                    ? String(record.date || record.dates || record.issueDate || '').trim()
                    : '';
                const line = [name, issuer].filter(Boolean).join(' — ');
                const text = [line, date].filter(Boolean).join('  ');
                if (!text) return [];
                return [new Paragraph({ children: [new TextRun({ text, font, size: bodySize, color: body })] })];
              }),
            ]
          : [],
    };

    for (const key of order) children.push(...(blocks[key] || []));

    const pxToTwip = (px: number) => Math.round(px * 15);
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: box.pageSize === 'A4' ? { width: 11906, height: 16838 } : { width: 12240, height: 15840 },
              margin: {
                top: pxToTwip(box.marginTop + 16),
                bottom: pxToTwip(box.marginBottom + 16),
                left: pxToTwip(box.marginLeft + 16),
                right: pxToTwip(box.marginRight + 16),
              },
            },
          },
          children,
        },
      ],
    });
    return Packer.toBuffer(doc);
  }

  async renderAll(
    applicationId: string,
    generationId: string,
    content: PromptResumeContent,
    templateConfig: object,
    baseFilename: string,
    formats: Array<'PDF' | 'DOCX'> = ['PDF', 'DOCX'],
  ) {
    const wantPdf = formats.includes('PDF');
    const wantDocx = formats.includes('DOCX');
    const html = wantPdf ? this.templatesService.renderPreviewHtml(content, templateConfig) : '';
    const [pdfBuffer, docxBuffer] = await Promise.all([
      wantPdf ? this.renderPdf(html, templateConfig) : Promise.resolve(null),
      wantDocx ? this.renderDocx(content, templateConfig) : Promise.resolve(null),
    ]);

    const saved: {
      type: 'PDF' | 'DOCX';
      kind: 'RESUME';
      filename: string;
      storagePath: string;
    }[] = [];
    if (pdfBuffer) {
      const filename = `${baseFilename}.pdf`;
      saved.push({
        type: 'PDF',
        kind: 'RESUME',
        filename,
        storagePath: await this.storage.saveFile(applicationId, generationId, filename, pdfBuffer),
      });
    }
    if (docxBuffer) {
      const filename = `${baseFilename}.docx`;
      saved.push({
        type: 'DOCX',
        kind: 'RESUME',
        filename,
        storagePath: await this.storage.saveFile(applicationId, generationId, filename, docxBuffer),
      });
    }
    return saved;
  }

  async renderCoverLetter(
    applicationId: string,
    generationId: string,
    cover: {
      greeting: string;
      paragraphs: string[];
      closing: string;
      signatureName: string;
      company: string;
      contact?: PromptResumeContent['contact'];
      jobTitle?: string;
      date?: string;
    },
    baseFilename: string,
    templateConfig: object = {},
    formats: Array<'PDF' | 'DOCX'> = ['PDF', 'DOCX'],
  ) {
    const normalized = usableCoverLetter(cover, cover.contact?.name || cover.signatureName);
    if (!normalized) throw new Error('The cover letter is missing valid content.');
    cover = { ...cover, ...normalized, signatureName: normalized.signatureName || cover.signatureName };
    const cfg = templateConfigSchema.parse(templateConfig) as {
      colors?: { primary?: string; heading?: string; body?: string };
      typography?: { bodyFont?: string; baseFontSize?: number; lineHeight?: number };
    };
    const font = cfg.typography?.bodyFont || 'Georgia';
    const bodyColor = cfg.colors?.body || '#334155';
    const headingColor = cfg.colors?.heading || '#1e293b';
    const primary = cfg.colors?.primary || '#1e3a5f';
    const fontSize = cfg.typography?.baseFontSize || 11;
    const lineHeight = cfg.typography?.lineHeight || 1.6;

    const coverBase = `${baseFilename}_CoverLetter`;
    const dateStr = coverLetterDate(cover.date);
    const contact = cover.contact || { name: cover.signatureName };
    const html = renderCoverLetterHtml({ ...cover, contact }, templateConfig);

    const docxChildren: Paragraph[] = [
      new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: contact.name, bold: true, size: 40, color: primary.replace('#', '') })] }),
      ...(contact.title ? [new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: contact.title, bold: true, size: 22 })] })] : []),
      ...coverLetterContactLines(contact).map(line => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: line, size: 18 })] })),
      new Paragraph({ spacing: { after: 200 }, children: [] }),
      new Paragraph({ children: [new TextRun({ text: dateStr, color: headingColor.replace('#', '') })] }),
      new Paragraph({ children: [] }),
      new Paragraph({ children: [new TextRun('Hiring Manager')] }),
      new Paragraph({ children: [new TextRun(cover.company)] }),
      ...(cover.jobTitle ? [new Paragraph({ spacing: { before: 120, after: 180 }, children: [new TextRun({ text: 'Application for ' + cover.jobTitle, bold: true })] })] : []),
      new Paragraph({ children: [] }),
      new Paragraph({ children: [new TextRun(cover.greeting)] }),
      new Paragraph({ children: [] }),
      ...cover.paragraphs.flatMap((para) => [
        new Paragraph({ children: [new TextRun(para)] }),
        new Paragraph({ children: [] }),
      ]),
      new Paragraph({ children: [new TextRun(cover.closing)] }),
      new Paragraph({ children: [new TextRun({ text: contact.name, bold: true })] }),
    ];

    const box = this.templatesService.pdfLayout(templateConfig);

    const wantPdf = formats.includes('PDF');
    const wantDocx = formats.includes('DOCX');
    const docx = wantDocx
      ? await Packer.toBuffer(new Document({
          styles: { default: { document: { run: { font, size: Math.round(fontSize * 2), color: bodyColor.replace('#', '') }, paragraph: { spacing: { line: Math.round(lineHeight * 240) } } } } },
          sections: [{ properties: { page: {
            size: box.pageSize === 'A4' ? { width: 11906, height: 16838 } : { width: 12240, height: 15840 },
            margin: { top: box.marginTop * 15, bottom: box.marginBottom * 15, left: box.marginLeft * 15, right: box.marginRight * 15 },
          } }, children: docxChildren }],
        }))
      : null;
    const pdfBuffer = wantPdf ? await this.renderPdf(html, templateConfig) : null;

    const saved: {
      type: 'PDF' | 'DOCX';
      kind: 'COVER_LETTER';
      filename: string;
      storagePath: string;
    }[] = [];
    if (pdfBuffer) {
      const filename = `${coverBase}.pdf`;
      saved.push({
        type: 'PDF',
        kind: 'COVER_LETTER',
        filename,
        storagePath: await this.storage.saveFile(applicationId, generationId, filename, pdfBuffer),
      });
    }
    if (docx) {
      const filename = `${coverBase}.docx`;
      saved.push({
        type: 'DOCX',
        kind: 'COVER_LETTER',
        filename,
        storagePath: await this.storage.saveFile(applicationId, generationId, filename, docx),
      });
    }
    return saved;
  }
}
