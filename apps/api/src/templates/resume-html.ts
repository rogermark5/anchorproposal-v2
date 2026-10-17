import {
  decorationSvg,
  sectionStyle,
  skillRows,
  experienceBullets,
  experienceDates,
  experienceTitle,
  experienceCompany,
  formatEducationLine,
  plainText,
  type PromptResumeContent,
} from "@anchorproposal/shared";
import { resumeHeadline } from "../common/utils/resume-headline";
import {
  resumeConfig,
  htmlEscape as esc,
  safeColor,
  safeFont,
  entryPieces,
  contactPieces,
  expertiseItems,
  sectionEnabled,
  sectionName,
  sectionOrder,
  type Piece,
} from "./resume-layout";

export function renderResumeHtml(content: object, input: object): string {
  const c = content as PromptResumeContent,
    cfg = resumeConfig(input),
    color = cfg.colors,
    t = cfg.typography,
    l = cfg.layout,
    st = cfg.styles;
  const accent = safeColor(color.accent, "#1e3a5f"),
    body = safeColor(color.body, "#334155"),
    heading = safeColor(color.heading, "#1e293b"),
    primary = safeColor(color.primary, "#1e3a5f"),
    muted = safeColor(color.muted, "#64748b");
  const margins = [
      l.marginTop,
      l.marginRight,
      l.marginBottom,
      l.marginLeft,
    ].map((n) => Math.max(28, Math.min(120, Number.isFinite(n) ? n : 36))),
    [mt, mr, mb, ml] = margins;
  const size = t.baseFontSize,
    fontSize = Math.max(6, Math.min(24, size)),
    nameSize = t.nameSize ?? Math.round(size * t.headingScale * 1.65),
    headingSize = t.headingSize ?? Math.round(size * t.headingScale * 0.95),
    subSize = t.subtextSize ?? Math.max(8, size - 1),
    contactSize = t.contactSize ?? Math.max(8, size - 1.5);
  const style = sectionStyle(cfg),
    order = sectionOrder(cfg),
    pageWidth = l.pageSize === "A4" ? "210mm" : "8.5in",
    pageHeight = l.pageSize === "A4" ? "297mm" : "11in";
  const renderPieces = (pieces: Piece[], separator: string, kind: string) =>
    [1, 2]
      .map((line) => {
        const row = pieces.filter((p) => p.line === line);
        if (!row.length) return "";
        const groups = ["left", "center", "right"].map((align) => {
          const items = row.filter((p) => p.align === align);
          return items.length
            ? `<div class="align-${align}">${items.map((p) => `<span data-element="${p.key}" style="font-weight:${p.bold ? 700 : 400};font-style:${p.italic ? "italic" : "normal"};color:${p.color}">${esc(p.text)}</span>`).join(`<span class="element-separator">${esc(separator)}</span>`)}</div>`
            : "";
        });
        return `<div class="element-line ${row.every((p) => p.align === row[0].align) ? "single-alignment" : ""}" data-line="${line}" data-kind="${kind}">${groups.join("")}</div>`;
      })
      .join("");
  const bulletList = (items: string[], gap = 60) =>
    items.length
      ? `<ul class="bullets" style="margin-top:${gap / 20}pt">${items.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>`
      : "";
  const entry = (
    kind: "experience" | "education" | "certifications" | "projects",
    row: Record<string, unknown>,
  ) => {
    const design = cfg[kind];
    if (!design && kind === "experience") {
      const loc = plainText(row.location || row.companyLocation);
      return `<div class="exp"><div class="exp-header"><span class="exp-title">${esc(experienceTitle(row))} — ${esc(experienceCompany(row))}</span><span class="dates">${esc(experienceDates(row))}</span></div>${loc ? `<div class="exp-loc">${esc(loc)}</div>` : ""}${bulletList(experienceBullets(row))}</div>`;
    }
    if (!design && kind === "education")
      return `<div class="edu">${esc(formatEducationLine(row))}</div>`;
    const rows = renderPieces(
      entryPieces(kind, row, cfg),
      design?.separator ?? "•",
      kind,
    );
    const description = kind === "projects" ? plainText(row.description) : "";
    const bullets =
      kind === "experience" || kind === "projects"
        ? experienceBullets(row)
        : [];
    return rows
      ? `<div class="entry ${kind}" style="--line-gap:${(design?.lineGap ?? 40) / 20}pt">${rows}${description ? `<p class="project-description">${esc(description)}</p>` : ""}${bulletList(bullets, design?.bulletGap ?? 60)}</div>`
      : "";
  };
  const skills = skillRows(c.skills || []),
    expertise = expertiseItems(c),
    headline =
      plainText(c.headline) ||
      resumeHeadline(c.experiences, c.contact?.title) ||
      "";
  const blocks: Record<string, string> = {
    summary: c.summary ? `<p>${esc(c.summary)}</p>` : "",
    skills: skills.length
      ? st.skillsLayout === "bullets"
        ? bulletList(skills.map((s) => `${s.category}: ${s.items}`))
        : skills
            .map(
              (s) =>
                `<div class="skill-row"><span class="skill-cat">${esc(s.category)}${st.skillsLayout === "lines" ? "" : ":"}</span>${st.skillsLayout === "lines" ? "<br/>" : " "}${esc(s.items)}</div>`,
            )
            .join("")
      : "",
    experience: (c.experiences || [])
      .map((row) => entry("experience", row))
      .join(""),
    education: (c.educations || [])
      .map((row) => entry("education", row))
      .join(""),
    certifications: (c.certificates || [])
      .map((row) => entry("certifications", row))
      .join(""),
    headline: headline ? `<p class="resume-headline">${esc(headline)}</p>` : "",
    expertise: expertise.length
      ? cfg.expertise.layout === "bullets"
        ? bulletList(expertise)
        : cfg.expertise.layout === "grid"
          ? `<div class="expertise-grid">${expertise.map((item) => `<div>${esc(item)}</div>`).join("")}</div>`
          : `<p>${expertise.map(esc).join(' <span class="expertise-dot">•</span> ')}</p>`
      : "",
    projects: (c.projects || []).map((row) => entry("projects", row)).join(""),
  };
  let number = 0;
  const sections = order
    .filter((key) => sectionEnabled(key, cfg) && blocks[key])
    .map((key) => {
      number++;
      const icon = (
        {
          summary: "≡",
          experience: "▣",
          education: "▤",
          skills: "⌘",
          certifications: "◇",
          headline: "✧",
          expertise: "✦",
          projects: "▦",
        } as Record<string, string>
      )[key];
      const mark =
        style === "numbered"
          ? String(number)
          : style === "icon"
            ? icon
            : (
                {
                  dot: "•",
                  square: "▪",
                  diamond: "◆",
                  chevron: "›",
                  leaf: "◖",
                } as Record<string, string>
              )[style];
      return `<section class="section section-${key}" data-section="${key}"><h2 class="section-heading style-${style}">${mark ? `<span class="heading-mark">${mark}</span>` : ""}<span class="heading-label">${esc(sectionName(key, cfg))}</span></h2>${st.headingLineStyle !== "none" ? '<div class="heading-rule"></div>' : ""}${blocks[key]}</section>`;
    })
    .join("");
  const headerTitle = cfg.contact.showJobTitle
      ? resumeHeadline(c.experiences, c.contact?.title)
      : "",
    lineColor = safeColor(st.headingLineColor, accent),
    lineWeight = st.headingLineThickness / 8;
  const artwork = decorationSvg(
    cfg.pdf.headerAccent,
    cfg.pdf.watermark,
    accent,
    cfg.pdf.watermarkOpacity,
  );
  const accentClearance =
    (
      {
        "top-rule": 47,
        "top-band": 44,
        "gradient-band": 56,
        "classy-lines": 50,
        "ladder-lines": 70,
        "double-corner": 50,
      } as Record<string, number>
    )[cfg.pdf.headerAccent] || 0;
  const headerInset = Math.max(0, accentClearance - mt),
    headerRight =
      l.headerAlignment === "right" &&
      [
        "bookmark",
        "corner-triangle",
        "two-tone-corner",
        "diagonal-cut",
        "double-corner",
      ].includes(cfg.pdf.headerAccent)
        ? 60
        : 0;
  const contacts =
    cfg.contact.layout === "stacked" &&
    !Object.keys(cfg.contact.elements).length
      ? contactPieces(c, cfg)
          .map((piece) => esc(piece.text))
          .join("<br/>")
      : renderPieces(contactPieces(c, cfg), l.contactSeparator, "contact");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page{size:${l.pageSize === "A4" ? "A4" : "Letter"};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}.page{padding:${mt}px ${mr}px ${mb}px ${ml}px;position:relative;isolation:isolate;width:${pageWidth};min-height:${pageHeight};margin:0 auto;background:#fff;color:${body};font-family:${safeFont(t.bodyFont)};font-size:${fontSize}pt;line-height:${Math.max(1, Math.min(2.2, t.lineHeight))};letter-spacing:${Math.max(0, Math.min(3, t.letterSpacing))}px;overflow-wrap:break-word}.sheet{position:relative;z-index:1;padding:0;border:0}.page-art{position:absolute;inset:0;z-index:0;pointer-events:none}.page-art svg{display:block;width:100%;height:100%}.header{padding-top:${headerInset}px;padding-right:${headerRight}px;text-align:${l.headerAlignment};margin:0 0 10px;break-inside:avoid}h1{margin:0;font-family:${safeFont(t.headingFont)};font-size:${nameSize}pt;line-height:1.15;color:${primary};font-weight:700;text-transform:${t.nameUppercase ? "uppercase" : "none"}}.headline{font-size:${Math.max(size, Math.round(size * 1.05))}pt;color:${heading};font-weight:600;margin-top:${l.nameContactGap}px}.contact{font-size:${contactSize}pt;margin-top:${Math.max(2, l.nameContactGap / 2)}px}.element-line{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:3px 10px;align-items:baseline;break-inside:avoid;break-after:avoid;min-width:0}.element-line.single-alignment{display:flex;justify-content:stretch}.element-line.single-alignment>div{width:100%}.align-left{text-align:left;grid-column:1}.align-center{text-align:center;grid-column:2}.align-right{text-align:right;grid-column:3}.element-line>div{min-width:0;overflow-wrap:anywhere}.element-separator{display:inline-block;margin:0 .45em;opacity:.65}.contact .element-line+.element-line{margin-top:3px}.section{margin-top:${l.sectionSpacing}px;break-inside:auto}.section-heading{font-family:${safeFont(t.headingFont)};font-size:${headingSize}pt;line-height:1.35;color:${heading};font-weight:700;text-transform:${t.headingUppercase ? "uppercase" : "none"};letter-spacing:.035em;text-align:${cfg.sections.headingAlignment};margin:0 0 5px;break-after:avoid;page-break-after:avoid;position:relative}.heading-label{display:inline-block;max-width:100%}.heading-mark{display:inline-block;color:${accent};margin-right:.45em;font-size:.95em}.style-underline .heading-label{${st.headingLineStyle === "none" ? `border-bottom:${lineWeight}pt solid ${accent};padding-bottom:2px;` : ""}}.style-filled-band{background:${cfg.pdf.sectionStyle ? accent : safeColor(color.sectionLabelBg, "#e8eef5")};color:${cfg.pdf.sectionStyle ? "#fff" : safeColor(color.sectionLabelText, heading)};border-radius:4px;padding:${cfg.pdf.sectionStyle ? "4px 8px" : "4px 0"}}.style-pill .heading-label{background:${safeColor(color.sectionLabelBg, "#e8eef5")};color:${safeColor(color.sectionLabelText, heading)};border:1px solid ${accent};border-radius:30px;padding:1px 14px}.style-boxed .heading-label{border:1px solid ${accent};outline:1px solid ${accent};outline-offset:2px;border-radius:20px;padding:0 10px;margin:3px}.style-side-block{border-left:${cfg.pdf.sectionStyle ? 4 : 0}px solid ${accent};padding-left:${cfg.pdf.sectionStyle ? 8 : 10}px}.style-double-rule{border-bottom:3px double ${accent};padding-bottom:3px}.style-brackets .heading-label:before{content:'[';color:${accent};margin-right:5px}.style-brackets .heading-label:after{content:']';color:${accent};margin-left:5px}.style-leaf .heading-mark{display:inline-block;width:7px;height:10px;font-size:0;background:${accent};border-radius:1px 8px 1px 8px;margin-left:3px;margin-right:7px;vertical-align:middle;transform:rotate(20deg)}.style-numbered .heading-mark{background:${accent};color:white;border-radius:50%;width:1.65em;height:1.65em;line-height:1.65;text-align:center;font-size:.7em;vertical-align:middle}.style-bar .heading-label{border-left:3px solid ${accent};padding-left:9px}.heading-rule{width:${st.headingLineStyle === "short" ? "35%" : "100%"};height:0;border-top:${lineWeight}pt ${st.headingLineStyle === "double" ? "double" : "solid"} ${lineColor};${st.headingLineStyle === "double" ? `border-top-width:${Math.max(2.25, lineWeight * 3)}pt;` : ""}margin:0 ${cfg.sections.headingAlignment === "right" ? "0 0 auto" : cfg.sections.headingAlignment === "center" ? "auto" : "0"};margin-bottom:${st.headingLineSpacing / 20}pt;break-after:avoid}.entry,.exp{margin-bottom:8px}.entry .element-line+.element-line{margin-top:var(--line-gap)}.entry .element-line{font-size:${size}pt}.entry [data-element=dates],.entry [data-element=date],.entry [data-element=location],.entry [data-element=jobType],.entry [data-element=url]{font-size:${subSize}pt}.exp-header{display:flex;justify-content:space-between;gap:4px 15px;flex-wrap:wrap;align-items:baseline;break-after:avoid}.exp-title{font-weight:${st.experienceTitleWeight === "bold" ? 700 : 400};color:${heading}}.exp-loc,.dates{font-size:${subSize}pt;color:${muted};font-style:${st.locationItalic ? "italic" : "normal"}}.exp-loc{margin:1px 0 2px;break-after:avoid}.bullets{list-style-type:${st.listStyle === "dash" || st.listStyle === "none" ? "none" : st.listStyle};padding-left:${st.listStyle === "none" ? 0 : 18}px;margin-bottom:0}.bullets li{margin:1px 0;break-inside:avoid;orphans:2;widows:2;${st.listStyle === "dash" ? "position:relative;" : ""}}${st.listStyle === "dash" ? '.bullets li:before{content:"-";position:absolute;left:-12px}' : ""}.skill-row{margin:2px 0}.skill-cat{font-weight:700;color:${heading}}.project-description{margin-top:3px}.expertise-grid{display:grid;grid-template-columns:repeat(${cfg.expertise.columns},minmax(0,1fr));gap:3px 14px}.expertise-dot{color:${accent};padding:0 3px}.resume-headline{font-size:${cfg.headline.fontSize || size}pt;color:${safeColor(cfg.headline.color, body)};font-weight:${cfg.headline.bold ? 700 : 400};font-style:${cfg.headline.italic ? "italic" : "normal"};text-align:${cfg.headline.alignment};margin:${cfg.headline.topGap / 20}pt 0 ${cfg.headline.bottomGap / 20}pt}p{margin:0;orphans:3;widows:3}
  @media print{html,body,.page{width:auto;min-height:0;margin:0;padding:0}.sheet{padding:${mt}px ${mr}px ${mb}px ${ml}px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.page-art{position:fixed;inset:0}.page-art svg{height:100%;width:100%}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body data-resume-design="full-page"><div class="page"><div class="page-art" aria-hidden="true">${artwork}</div><div class="sheet"><header class="header"><h1>${esc(c.contact?.name || "Candidate Name")}</h1>${headerTitle ? `<div class="headline">${esc(headerTitle)}</div>` : ""}<div class="contact">${contacts}</div></header>${sections}</div></div></body></html>`;
}
