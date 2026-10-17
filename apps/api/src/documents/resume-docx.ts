import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
  TableLayoutType,
} from "docx";
import {
  experienceBullets,
  experienceTitle,
  experienceCompany,
  experienceDates,
  formatEducationLine,
  plainText,
  skillRows,
  sectionStyle,
  type PromptResumeContent,
} from "@anchorproposal/shared";
import {
  resumeConfig,
  entryPieces,
  contactPieces,
  expertiseItems,
  sectionEnabled,
  sectionOrder,
  sectionName,
  safeColor,
  type Piece,
} from "../templates/resume-layout";
import { resumeHeadline } from "../common/utils/resume-headline";

export async function resumeDocx(
  content: PromptResumeContent,
  input: object,
): Promise<Buffer> {
  const cfg = resumeConfig(input),
    font = cfg.typography.bodyFont,
    headingFont = cfg.typography.headingFont,
    bodySize = cfg.typography.baseFontSize * 2,
    headingSize = (cfg.typography.headingSize || 12) * 2,
    contactSize = (cfg.typography.contactSize || 9) * 2;
  const color = (value: unknown, fallback = "#334155") =>
      safeColor(value, fallback).slice(1),
    body = color(cfg.colors.body),
    heading = color(cfg.colors.heading, "#1e293b"),
    accent = color(cfg.colors.accent, "#1e3a5f"),
    muted = color(cfg.colors.muted, "#64748b");
  const align = (value: string) =>
    value === "right"
      ? AlignmentType.RIGHT
      : value === "center"
        ? AlignmentType.CENTER
        : AlignmentType.LEFT;
  const run = (
    text: string,
    options: Partial<ConstructorParameters<typeof TextRun>[0] & object> = {},
  ) => new TextRun({ text, font, size: bodySize, color: body, ...options });
  const paragraph = (text: string, options: Record<string, unknown> = {}) =>
    new Paragraph({
      spacing: { after: 40, line: Math.round(cfg.typography.lineHeight * 240) },
      children: [run(text)],
      ...options,
    });
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    tableBorders = {
      top: noBorder,
      bottom: noBorder,
      left: noBorder,
      right: noBorder,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
    };
  const layoutLines = (
    pieces: Piece[],
    separator: string,
    lineGap = 40,
  ): Array<Paragraph | Table> =>
    [1, 2].flatMap((line) => {
      const row = pieces.filter((p) => p.line === line);
      if (!row.length) return [];
      const groups = (["left", "center", "right"] as const)
        .map((side) => ({ side, items: row.filter((p) => p.align === side) }))
        .filter((group) => group.items.length);
      const make = (items: Piece[], side: string) =>
        new Paragraph({
          alignment: align(side),
          keepNext: true,
          spacing: {
            before: line === 2 ? lineGap : 0,
            after: 0,
            line: Math.round(cfg.typography.lineHeight * 240),
          },
          children: items.flatMap((p, index) => [
            ...(index
              ? [run(` ${separator} `, { size: contactSize, color: muted })]
              : []),
            run(p.text, {
              bold: p.bold,
              italics: p.italic,
              color: color(p.color),
              size: [
                "dates",
                "date",
                "location",
                "jobType",
                "url",
                "email",
                "phone",
                "linkedin",
                "links",
              ].includes(p.key)
                ? contactSize
                : bodySize,
            }),
          ]),
        });
      if (groups.length === 1) return [make(groups[0].items, groups[0].side)];
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.FIXED,
          borders: tableBorders,
          columnWidths: groups.map(() => Math.floor(9500 / groups.length)),
          rows: [
            new TableRow({
              cantSplit: true,
              children: groups.map(
                (group) =>
                  new TableCell({
                    width: {
                      size: 100 / groups.length,
                      type: WidthType.PERCENTAGE,
                    },
                    margins: { top: 0, bottom: 0, left: 0, right: 0 },
                    verticalAlign: VerticalAlign.CENTER,
                    children: [make(group.items, group.side)],
                  }),
              ),
            }),
          ],
        }),
      ];
    });
  const list = (items: string[], gap = 60) =>
    items.map(
      (text, index) =>
        new Paragraph({
          keepLines: true,
          spacing: {
            before: index === 0 ? gap : 0,
            after: 20,
            line: Math.round(cfg.typography.lineHeight * 240),
          },
          ...(cfg.styles.listStyle !== "disc" ? {} : { bullet: { level: 0 } }),
          children: [
            run(
              (cfg.styles.listStyle === "dash"
                ? "- "
                : cfg.styles.listStyle === "square"
                  ? "▪ "
                  : cfg.styles.listStyle === "circle"
                    ? "○ "
                    : "") + text,
            ),
          ],
        }),
    );
  const entry = (
    kind: "experience" | "education" | "certifications" | "projects",
    row: Record<string, unknown>,
  ): Array<Paragraph | Table> => {
    const design = cfg[kind];
    if (!design && kind === "experience")
      return [
        new Paragraph({
          keepNext: true,
          children: [
            run(`${experienceTitle(row)} — ${experienceCompany(row)}`, {
              bold: cfg.styles.experienceTitleWeight === "bold",
              color: heading,
            }),
            run(`  ${experienceDates(row)}`, {
              size: contactSize,
              color: muted,
            }),
          ],
        }),
        ...(row.location || row.companyLocation
          ? [
              new Paragraph({
                keepNext: true,
                children: [
                  run(plainText(row.location || row.companyLocation), {
                    size: contactSize,
                    color: muted,
                    italics: cfg.styles.locationItalic,
                  }),
                ],
              }),
            ]
          : []),
        ...list(experienceBullets(row)),
      ];
    if (!design && kind === "education")
      return [paragraph(formatEducationLine(row))];
    return [
      ...layoutLines(
        entryPieces(kind, row, cfg),
        design?.separator ?? "•",
        design?.lineGap,
      ),
      ...(kind === "projects" && plainText(row.description)
        ? [paragraph(plainText(row.description))]
        : []),
      ...(kind === "projects" || kind === "experience"
        ? list(experienceBullets(row), design?.bulletGap)
        : []),
    ];
  };
  const headerAlign = align(cfg.layout.headerAlignment),
    contact = content.contact,
    title = resumeHeadline(content.experiences, contact.title);
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: headerAlign,
      keepNext: true,
      children: [
        run(
          cfg.typography.nameUppercase
            ? contact.name.toUpperCase()
            : contact.name,
          {
            font: headingFont,
            bold: true,
            size: (cfg.typography.nameSize || 20) * 2,
            color: color(cfg.colors.primary, "#1e3a5f"),
          },
        ),
      ],
    }),
  ];
  if (title && cfg.contact.showJobTitle)
    children.push(
      new Paragraph({
        alignment: headerAlign,
        keepNext: true,
        spacing: { before: Math.round(cfg.layout.nameContactGap * 15) },
        children: [run(title, { bold: true, color: heading })],
      }),
    );
  const contactRows = contactPieces(content, cfg).map((p) => ({
    ...p,
    color: p.color,
  }));
  if (Object.keys(cfg.contact.elements).length)
    children.push(...layoutLines(contactRows, cfg.layout.contactSeparator));
  else if (contactRows.length)
    children.push(
      new Paragraph({
        alignment: headerAlign,
        spacing: {
          after: 160,
          before: Math.round(cfg.layout.nameContactGap * 7.5),
        },
        children: contactRows.flatMap((p, i) => [
          run(
            (i && cfg.contact.layout === "single"
              ? ` ${cfg.layout.contactSeparator} `
              : "") + p.text,
            {
              break: i && cfg.contact.layout === "stacked" ? 1 : undefined,
              size: contactSize,
              color: color(cfg.colors.contact, "#475569"),
            },
          ),
        ]),
      }),
    );
  const skills = skillRows(content.skills || []),
    expertise = expertiseItems(content),
    headline = plainText(content.headline) || title || "";
  const blocks: Record<string, Array<Paragraph | Table>> = {
    summary: content.summary ? [paragraph(content.summary)] : [],
    skills:
      cfg.styles.skillsLayout === "bullets"
        ? list(skills.map((group) => `${group.category}: ${group.items}`))
        : skills.map(
            (group) =>
              new Paragraph({
                spacing: { after: 30 },
                children: [
                  run(
                    group.category +
                      (cfg.styles.skillsLayout === "lines" ? "" : ": "),
                    { bold: true, color: heading },
                  ),
                  run(group.items, {
                    break: cfg.styles.skillsLayout === "lines" ? 1 : undefined,
                  }),
                ],
              }),
          ),
    experience: (content.experiences || []).flatMap((row) =>
      entry("experience", row),
    ),
    education: (content.educations || []).flatMap((row) =>
      entry("education", row),
    ),
    certifications: (content.certificates || []).flatMap((row) =>
      entry("certifications", row),
    ),
    headline: headline
      ? [
          new Paragraph({
            alignment: align(cfg.headline.alignment),
            spacing: {
              before: cfg.headline.topGap,
              after: cfg.headline.bottomGap,
            },
            children: [
              run(headline, {
                size: (cfg.headline.fontSize || bodySize / 2) * 2,
                color: color(cfg.headline.color),
                bold: cfg.headline.bold,
                italics: cfg.headline.italic,
              }),
            ],
          }),
        ]
      : [],
    expertise:
      cfg.expertise.layout === "bullets"
        ? list(expertise)
        : cfg.expertise.layout === "grid" && expertise.length
          ? [
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: tableBorders,
                rows: Array.from(
                  {
                    length: Math.ceil(expertise.length / cfg.expertise.columns),
                  },
                  (_, i) =>
                    new TableRow({
                      children: Array.from(
                        { length: cfg.expertise.columns },
                        (_, j) =>
                          new TableCell({
                            width: {
                              size: 100 / cfg.expertise.columns,
                              type: WidthType.PERCENTAGE,
                            },
                            children: [
                              paragraph(
                                expertise[i * cfg.expertise.columns + j] || "",
                              ),
                            ],
                          }),
                      ),
                    }),
                ),
              }),
            ]
          : expertise.length
            ? [paragraph(expertise.join(" • "))]
            : [],
    projects: (content.projects || []).flatMap((row) => entry("projects", row)),
  };
  let number = 0;
  const decoration = sectionStyle(cfg);
  for (const key of sectionOrder(cfg)) {
    if (!sectionEnabled(key, cfg) || !blocks[key].length) continue;
    number++;
    const prefix =
      decoration === "numbered"
        ? `${number}. `
        : (
            {
              leaf: "◖ ",
              icon: "◆ ",
              dot: "• ",
              square: "▪ ",
              diamond: "◆ ",
              chevron: "› ",
            } as Record<string, string>
          )[decoration] || "";
    let label = sectionName(key, cfg);
    if (cfg.typography.headingUppercase) label = label.toUpperCase();
    if (decoration === "brackets") label = `[ ${label} ]`;
    const line =
      cfg.styles.headingLineStyle !== "none" ||
      ["underline", "double-rule", "boxed", "pill"].includes(decoration);
    children.push(
      new Paragraph({
        alignment: align(cfg.sections.headingAlignment),
        keepNext: true,
        spacing: {
          before: Math.round(cfg.layout.sectionSpacing * 15),
          after: cfg.styles.headingLineSpacing,
        },
        ...(line
          ? {
              border: {
                bottom: {
                  color: color(cfg.styles.headingLineColor, cfg.colors.accent),
                  size: cfg.styles.headingLineThickness,
                  style:
                    cfg.styles.headingLineStyle === "double" ||
                    decoration === "double-rule"
                      ? BorderStyle.DOUBLE
                      : BorderStyle.SINGLE,
                },
              },
            }
          : {}),
        ...(["bar", "side-block"].includes(decoration)
          ? {
              border: {
                left: {
                  color: accent,
                  size: 16,
                  style: BorderStyle.SINGLE,
                  space: 5,
                },
              },
            }
          : {}),
        ...(decoration === "filled-band" ? { shading: { fill: accent } } : {}),
        children: [
          run(prefix + label, {
            font: headingFont,
            size: headingSize,
            bold: true,
            color: decoration === "filled-band" ? "FFFFFF" : heading,
          }),
        ],
      }),
      ...blocks[key],
    );
  }
  const margin = (n: number) => Math.round(Math.max(28, Math.min(120, n)) * 15);
  return Packer.toBuffer(
    new Document({
      styles: {
        default: {
          document: {
            run: { font, size: bodySize, color: body },
            paragraph: {
              spacing: {
                line: Math.round(cfg.typography.lineHeight * 240),
                after: 40,
              },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size:
                cfg.layout.pageSize === "A4"
                  ? { width: 11906, height: 16838 }
                  : { width: 12240, height: 15840 },
              margin: {
                top: margin(cfg.layout.marginTop),
                bottom: margin(cfg.layout.marginBottom),
                left: margin(cfg.layout.marginLeft),
                right: margin(cfg.layout.marginRight),
              },
            },
          },
          children,
        },
      ],
    }),
  );
}
