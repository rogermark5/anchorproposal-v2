import { resumeDocx } from './resume-docx';
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
    const fullPageArt=html.includes('data-resume-design="full-page"');
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
          top: `${fullPageArt?0:box.marginTop}px`,
          right: `${fullPageArt?0:box.marginRight}px`,
          bottom: `${fullPageArt?0:box.marginBottom}px`,
          left: `${fullPageArt?0:box.marginLeft}px`,
        },
      });
      return Buffer.from(pdf);
    } finally {
      if (existingBrowser) await page?.close();
      else await browser.close();
    }
  }

  async renderDocx(content: PromptResumeContent, templateConfig: object = {}): Promise<Buffer> {
    return resumeDocx(content, templateConfig);
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
      contact?: { showJobTitle?: boolean };
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
      ...(contact.title && cfg.contact?.showJobTitle !== false ? [new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: contact.title, bold: true, size: 22 })] })] : []),
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
