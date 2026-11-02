// Render every built-in template and reference theme without using a live database.
require('reflect-metadata'); require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs/promises'), { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const puppeteer = require('puppeteer'), { DESIGN_THEMES } = require('@anchorproposal/shared');
const { TemplatesService } = require('../dist/templates/templates.service'), { DocumentRendererService } = require('../dist/documents/document-renderer.service');
const { TEMPLATE_CATALOG } = require('../prisma/template-catalog.ts');
(async () => {
  const folder = path.resolve('../../tmp/template-qa/certificate-dates'); await fs.mkdir(folder, { recursive: true });
  // QA_PYTHON selects a Python runtime with pypdf; pdftoppm supplies PDF screenshots.
  const python = process.env.QA_PYTHON || 'python', pdftoppm = process.env.QA_PDFTOPPM || (process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm');
  const templates = new TemplatesService({}), renderer = new DocumentRendererService(templates, {}), browser = await puppeteer.launch({ headless: 'shell', pipe: true, timeout: 120000, protocolTimeout: 120000, userDataDir: path.join(folder, 'chrome-' + randomUUID()) });
  const configs = [...TEMPLATE_CATALOG.map(row => [row.preset, row.configJson]), ...DESIGN_THEMES.map(theme => ['theme-' + theme.id, { pdf: { headerAccent: theme.accent, watermark: theme.watermark, sectionStyle: theme.section } }])].filter(([name]) => !process.env.QA_TEMPLATE || name === process.env.QA_TEMPLATE);
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(60000); await page.setViewport({ width: 1000, height: 1300 });
    for (const [name, config] of configs) {
      const content = templates.getSamplePreviewContent(), html = templates.renderPreviewHtml(content, config);
      await page.setContent(html); await page.evaluate(() => document.fonts.ready);
      const ranges = await page.$$eval('[data-section="certifications"] [data-element="date"]', elements => elements.map(el => {
        const rect = el.getBoundingClientRect(), sheet = document.querySelector('.sheet').getBoundingClientRect();
        return { text: el.textContent, width: rect.width, left: rect.left, right: rect.right, sheetLeft: sheet.left, sheetRight: sheet.right };
      }));
      assert.deepEqual(ranges.map(row => row.text), ['Mar 2022 - Mar 2024', 'Jun 2023 - Jun 2025'], name);
      for (const row of ranges) assert.ok(row.width > 0 && row.left >= row.sheetLeft - 1 && row.right <= row.sheetRight + 1, name + ': date must be visible inside margins: ' + JSON.stringify(row));
      const pdf = path.join(folder, name + '.pdf'); await fs.writeFile(pdf, await renderer.renderPdf(html, config, browser));
      const text = spawnSync(python, ['-X', 'utf8', '-c', 'import sys; from pypdf import PdfReader; print(" ".join(" ".join(page.extract_text() or "" for page in PdfReader(sys.argv[1]).pages).split()))', pdf], { windowsHide: true, encoding: 'utf8' }); assert.equal(text.status, 0, text.error?.message || text.stderr);
      for (const range of ['Mar 2022 - Mar 2024', 'Jun 2023 - Jun 2025']) assert.ok(text.stdout.includes(range), name + ': PDF ' + range);
      if (['modern-minimal', 'classic-professional', 'compact-technical'].includes(name)) {
        const rendered = spawnSync(pdftoppm, ['-f', '1', '-singlefile', '-scale-to', '1200', '-png', pdf, path.join(folder, name)], { windowsHide: true, encoding: 'utf8' }); assert.equal(rendered.status, 0, rendered.error?.message || rendered.stderr);
      }
      console.log('PASS PDF ' + name);
    }
    console.log('PASS: source issue/expiration dates are visible and survive PDF export in ' + configs.length + ' built-in templates/themes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
