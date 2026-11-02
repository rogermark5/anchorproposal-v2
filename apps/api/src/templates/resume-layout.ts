import {
  templateConfigSchema,
  orderedSections,
  SECTION_LABELS,
  ELEMENT_DEFAULTS,
  skillRows,
  plainText,
  plainTextList,
  experienceTitle,
  experienceCompany,
  experienceDates,
  certificateDates,
  type TemplateConfig,
  type PromptResumeContent,
  type ElementDesign,
} from "@anchorproposal/shared";
export const htmlEscape = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const safeColor = (value: unknown, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : fallback;
export const safeFont = (value: string) =>
  `"${value.replace(/[^a-z0-9 ,_-]/gi, "").trim() || "Arial"}",${/georgia|garamond|times|cambria|palatino/i.test(value) ? "serif" : "sans-serif"}`;
export function resumeConfig(input: object): TemplateConfig {
  const parsed = templateConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : templateConfigSchema.parse({});
}
export type Piece = {
  key: string;
  text: string;
  line: 1 | 2;
  align: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
  color: string;
};
export function entryPieces(
  kind: "experience" | "education" | "certifications" | "projects",
  row: Record<string, unknown>,
  cfg: TemplateConfig,
): Piece[] {
  const design = cfg[kind],
    record: Record<string, unknown> =
      kind === "experience"
        ? {
            title: experienceTitle(row),
            company: experienceCompany(row),
            location: plainText(row.location || row.companyLocation),
            dates: experienceDates(row),
            jobType: plainText(row.jobType),
          }
        : kind === "education"
          ? {
              degree: plainText(row.degree || row.major),
              institution: plainText(
                row.institution || row.school || row.university,
              ),
              location: plainText(row.location),
              dates:
                plainText(row.dates) ||
                [row.startDate, row.endDate]
                  .map(plainText)
                  .filter(Boolean)
                  .join(" – "),
            }
          : kind === "certifications"
            ? {
                name: plainText(row.name || row.title),
                issuer: plainText(row.issuer || row.organization),
                date: certificateDates(row),
              }
            : {
                name: plainText(row.name || row.title),
                url: plainText(row.url),
                technologies: plainText(row.technologies),
                dates: plainText(row.dates),
              };
  return Object.entries(record).flatMap(([key, value]) => {
    const el: ElementDesign = {
      ...ELEMENT_DEFAULTS[kind][key],
      ...design?.elements[key],
    };
    if (
      el.visible === false ||
      !value ||
      (kind === "certifications" &&
        ((key === "issuer" && !cfg.styles.showCertIssuer) ||
          (key === "date" && !cfg.styles.showCertDate)))
    )
      return [];
    return [
      {
        key,
        text: String(value),
        line: design?.layout === "single" ? 1 : el.line || 1,
        align: el.align || "left",
        bold: el.bold === true,
        italic: el.italic === true,
        color: safeColor(
          el.color,
          ["dates", "date", "location", "jobType", "url"].includes(key)
            ? safeColor(cfg.colors.muted, "#64748b")
            : safeColor(cfg.colors.heading, "#1e293b"),
        ),
      },
    ];
  });
}
export function contactPieces(
  content: PromptResumeContent,
  cfg: TemplateConfig,
): Piece[] {
  const c = content.contact,
    entries: [string, string | undefined, boolean][] = [
      ["location", c.address, cfg.contact.showLocation],
      ["email", c.email, cfg.contact.showEmail],
      ["phone", c.phone, cfg.contact.showPhone],
      ["linkedin", c.linkedin, cfg.contact.showLinkedin],
      [
        "links",
        (c.links || [])
          .filter((link) => link.url !== c.linkedin)
          .map((link) => link.url)
          .join(` ${cfg.layout.contactSeparator} `),
        true,
      ],
    ];
  return entries.flatMap(([key, text, shown], index) => {
    const el = cfg.contact.elements[key] || {};
    return !shown || !text || el.visible === false
      ? []
      : [
          {
            key,
            text,
            line:
              cfg.contact.layout === "single"
                ? 1
                : el.line || (index > 1 ? 2 : 1),
            align: el.align || cfg.layout.headerAlignment,
            bold: el.bold === true,
            italic: el.italic === true,
            color: safeColor(
              el.color,
              safeColor(cfg.colors.contact, "#475569"),
            ),
          },
        ];
  });
}
export function expertiseItems(content: PromptResumeContent): string[] {
  return content.coreExpertise?.length
    ? plainTextList(content.coreExpertise)
    : skillRows(content.skills || []).map((row) => row.category);
}
export function sectionEnabled(key: string, cfg: TemplateConfig): boolean {
  return ["headline", "expertise"].includes(key)
    ? cfg.sections.visibility[key] === true
    : cfg.sections.visibility[key] !== false;
}
export function sectionName(key: string, cfg: TemplateConfig): string {
  return (
    cfg.sections.labels[key]?.trim() ||
    SECTION_LABELS[key as keyof typeof SECTION_LABELS] ||
    key
  );
}
export function sectionOrder(cfg: TemplateConfig) {
  return orderedSections(cfg.sections.order);
}
