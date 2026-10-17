/** Shared designer vocabulary, defaults and safe vector artwork for preview/PDF. */
export const TEMPLATE_SECTIONS = [
  "summary",
  "experience",
  "education",
  "skills",
  "certifications",
  "headline",
  "expertise",
  "projects",
] as const;
export type TemplateSection = (typeof TEMPLATE_SECTIONS)[number];
export const SECTION_LABELS: Record<TemplateSection, string> = {
  summary: "Professional Summary",
  experience: "Professional Experience",
  education: "Education",
  skills: "Technical Skills",
  certifications: "Certifications",
  headline: "Headline",
  expertise: "Core Expertise",
  projects: "Proud of Projects",
};
export const HEADER_ACCENTS = [
  "none",
  "top-rule",
  "side",
  "corner-triangle",
  "two-tone-corner",
  "double-corner",
  "corner-frame",
  "diagonal-cut",
  "angled-banner",
  "ribbon-tab",
  "bookmark",
  "top-band",
  "gradient-band",
  "sun-rays",
  "classy-lines",
  "ladder-lines",
] as const;
export const WATERMARKS = [
  "none",
  "soft-circle",
  "concentric-rings",
  "corner-arc",
  "diagonal-lines",
  "dot-grid",
  "line-grid",
  "dot-scatter",
  "soft-blobs",
  "stars",
  "bubbles",
  "leaves",
  "polygons",
  "doodle",
] as const;
export const SECTION_STYLES = [
  "none",
  "underline",
  "filled-band",
  "pill",
  "boxed",
  "side-block",
  "double-rule",
  "brackets",
  "leaf",
  "numbered",
  "icon",
  "dot",
  "square",
  "diamond",
  "chevron",
  "bar",
] as const;
export type HeaderAccent = (typeof HEADER_ACCENTS)[number];
export type Watermark = (typeof WATERMARKS)[number];
export type SectionStyle = (typeof SECTION_STYLES)[number];
export const DESIGN_THEMES: {
  id: string;
  label: string;
  accent: HeaderAccent;
  watermark: Watermark;
  section: SectionStyle;
  color: string;
}[] = [
  {
    id: "classy",
    label: "Classy",
    accent: "classy-lines",
    watermark: "none",
    section: "underline",
    color: "#1e3a5f",
  },
  {
    id: "stanford",
    label: "Stanford",
    accent: "top-band",
    watermark: "none",
    section: "filled-band",
    color: "#1e3a5f",
  },
  {
    id: "gradient",
    label: "Gradient",
    accent: "gradient-band",
    watermark: "none",
    section: "filled-band",
    color: "#3478a6",
  },
  {
    id: "polygon",
    label: "Polygon",
    accent: "two-tone-corner",
    watermark: "polygons",
    section: "brackets",
    color: "#475569",
  },
  {
    id: "ladder",
    label: "Ladder",
    accent: "ladder-lines",
    watermark: "none",
    section: "double-rule",
    color: "#1e3a5f",
  },
  {
    id: "bubbles",
    label: "Bubbles",
    accent: "none",
    watermark: "bubbles",
    section: "pill",
    color: "#46658a",
  },
  {
    id: "vegan",
    label: "Vegan",
    accent: "none",
    watermark: "leaves",
    section: "leaf",
    color: "#35634e",
  },
  {
    id: "sunny",
    label: "Sunny",
    accent: "sun-rays",
    watermark: "none",
    section: "numbered",
    color: "#ac762e",
  },
  {
    id: "bookmark",
    label: "Bookmark",
    accent: "bookmark",
    watermark: "none",
    section: "bar",
    color: "#1e3a5f",
  },
  {
    id: "los",
    label: "Los",
    accent: "none",
    watermark: "stars",
    section: "boxed",
    color: "#5c658b",
  },
  {
    id: "blurred",
    label: "Blurred",
    accent: "none",
    watermark: "soft-blobs",
    section: "underline",
    color: "#4c637a",
  },
  {
    id: "rhubarb",
    label: "Rhubarb",
    accent: "diagonal-cut",
    watermark: "soft-circle",
    section: "pill",
    color: "#6e4f64",
  },
];
export const designLabel = (value: string) =>
  value === "side"
    ? "Side Accent"
    : value
        .split("-")
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" ");
export type ElementDesign = {
  visible?: boolean;
  line?: 1 | 2;
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  color?: string;
};
export const ELEMENT_DEFAULTS: Record<string, Record<string, ElementDesign>> = {
  contact: {
    email: { line: 1 },
    phone: { line: 1 },
    location: { line: 1 },
    linkedin: { line: 1 },
    links: { line: 2 },
  },
  experience: {
    title: { line: 1, align: "left", bold: true },
    company: { line: 2, align: "left" },
    location: { line: 2, align: "left" },
    dates: { line: 1, align: "right", italic: true },
    jobType: { line: 2, align: "right", italic: true },
  },
  education: {
    degree: { line: 1, align: "left", bold: true },
    institution: { line: 2, align: "left" },
    location: { line: 2, align: "left" },
    dates: { line: 1, align: "right", italic: true },
  },
  certifications: {
    name: { line: 1, align: "left", bold: true },
    issuer: { line: 2, align: "left" },
    date: { line: 1, align: "right", italic: true },
  },
  projects: {
    name: { line: 1, align: "left", bold: true },
    url: { line: 2, align: "left" },
    technologies: { line: 2, align: "left" },
    dates: { line: 1, align: "right", italic: true },
  },
};
export function orderedSections(
  order: readonly string[] = [],
): TemplateSection[] {
  return [...new Set([...order, ...TEMPLATE_SECTIONS])].filter(
    (key): key is TemplateSection =>
      TEMPLATE_SECTIONS.includes(key as TemplateSection),
  );
}
export function sectionStyle(config: {
  pdf?: { sectionStyle?: string };
  styles?: { sectionHeadingStyle?: string };
}): SectionStyle {
  if (SECTION_STYLES.includes(config.pdf?.sectionStyle as SectionStyle))
    return config.pdf!.sectionStyle as SectionStyle;
  return (
    (
      {
        plain: "none",
        background: "filled-band",
        bar: "side-block",
        underline: "none",
      } as Record<string, SectionStyle>
    )[config.styles?.sectionHeadingStyle || "plain"] || "none"
  );
}
/** All inputs are allowlisted or reduced to hex; SVG never includes external content. */
export function decorationSvg(
  accent: string = "none",
  watermark: string = "none",
  color: string = "#1e3a5f",
  opacity = 0.12,
): string {
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : "#1e3a5f",
    alpha = Math.max(0.02, Math.min(0.3, opacity));
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = c,
    extra = "",
  ) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
  const line = (x: number, y: number, x2: number, y2: number, width = 1) =>
    `<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="${c}" stroke-width="${width}"/>`;
  let top = "",
    back = "";
  switch (accent) {
    case "top-rule":
      top = line(34, 30, 578, 30, 2);
      break;
    case "side":
      top = rect(20, 30, 3, 732);
      break;
    case "corner-triangle":
      top = `<path d="M552 0H612V60Z" fill="${c}"/>`;
      break;
    case "two-tone-corner":
      top = `<path d="M530 0H612V82Z" fill="${c}" opacity=".45"/><path d="M567 0H612V45Z" fill="${c}"/>`;
      break;
    case "double-corner":
      top = `<path d="M526 20H592V86M540 34H578V72" fill="none" stroke="${c}" stroke-width="3"/>`;
      break;
    case "corner-frame":
      top = `<path d="M20 76V20H76M536 772H592V716" fill="none" stroke="${c}" stroke-width="3"/>`;
      break;
    case "diagonal-cut":
      top = `<path d="M552 54L612 0V54L578 88Z" fill="${c}"/>`;
      break;
    case "angled-banner":
      top = `<path d="M30 29H160L146 43H30Z" fill="${c}"/>`;
      break;
    case "ribbon-tab":
      top = `<path d="M12 0H21V95L16.5 87L12 95Z" fill="${c}"/>`;
      break;
    case "bookmark":
      top = `<path d="M586 0H606V90L596 80L586 90Z" fill="${c}"/>`;
      break;
    case "top-band":
      top = rect(0, 0, 612, 27);
      break;
    case "gradient-band":
      top = rect(0, 0, 612, 36, `url(#td-gradient-${c.slice(1)})`);
      break;
    case "sun-rays":
      top = `<path d="M574 0A38 38 0 0 0 612 38V0Z" fill="${c}"/>`;
      break;
    case "classy-lines":
      top =
        line(34, 25, 578, 25, 2) +
        line(34, 33, 578, 33) +
        line(34, 760, 578, 760) +
        line(34, 767, 578, 767, 2);
      break;
    case "ladder-lines":
      top = [20, 29, 38, 47]
        .map((y, i) => line(34, y, 578, y, i === 0 ? 2 : 1))
        .join("");
      break;
  }
  switch (watermark) {
    case "soft-circle":
      back = `<circle cx="596" cy="780" r="85" fill="${c}"/>`;
      break;
    case "concentric-rings":
      back = [30, 55, 80, 105]
        .map(
          (r) =>
            `<circle cx="612" cy="0" r="${r}" fill="none" stroke="${c}" stroke-width="2"/>`,
        )
        .join("");
      break;
    case "corner-arc":
      back = `<circle cx="620" cy="-8" r="105" fill="none" stroke="${c}" stroke-width="12"/>`;
      break;
    case "diagonal-lines":
      back = Array.from({ length: 9 }, (_, i) =>
        line(505 + i * 15, 0, 612, 107 - i * 15),
      ).join("");
      break;
    case "dot-grid":
      back = Array.from(
        { length: 36 },
        (_, i) =>
          `<circle cx="${516 + (i % 6) * 13}" cy="${22 + Math.floor(i / 6) * 13}" r="2.2" fill="${c}"/>`,
      ).join("");
      break;
    case "line-grid":
      back = Array.from(
        { length: 8 },
        (_, i) =>
          line(500 + i * 12, 18, 500 + i * 12, 102) +
          line(500, 18 + i * 12, 584, 18 + i * 12),
      ).join("");
      break;
    case "dot-scatter":
      back = rect(0, 0, 612, 792, `url(#td-dots-${c.slice(1)})`);
      break;
    case "soft-blobs":
      back = `<g filter="url(#td-blur-${c.slice(1)})"><ellipse cx="530" cy="70" rx="95" ry="105" fill="${c}"/><ellipse cx="75" cy="695" rx="80" ry="95" fill="${c}"/></g>`;
      break;
    case "stars":
      back = `<g fill="${c}"><path d="M560 25l7 17h18l-14 11 6 18-17-11-16 11 6-18-14-11h18Z"/><path d="M520 58l3 8h9l-7 5 3 9-8-5-8 5 3-9-7-5h9Z"/><path d="M45 733l4 10h11l-9 7 4 10-10-6-9 6 3-10-9-7h12Z"/></g>`;
      break;
    case "bubbles":
      back = `<circle cx="552" cy="55" r="50" fill="${c}"/><circle cx="552" cy="55" r="23" fill="none" stroke="${c}" stroke-width="5"/><circle cx="598" cy="51" r="14" fill="${c}"/>`;
      break;
    case "leaves":
      back = `<g fill="${c}"><ellipse cx="560" cy="43" rx="14" ry="38" transform="rotate(40 560 43)"/><ellipse cx="586" cy="48" rx="12" ry="26" transform="rotate(-25 586 48)"/></g>`;
      break;
    case "polygons":
      back = `<path d="M554 22l28 16v32l-28 16-28-16V38Z" fill="${c}"/><path d="M586 66l15 9v18l-15 9-15-9V75Z" fill="${c}"/>`;
      break;
    case "doodle":
      back = `<path d="M325 30q20-25 40 0t40 0t40 0t40 0" fill="none" stroke="${c}" stroke-width="5"/>`;
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="td-gradient-${c.slice(1)}"><stop stop-color="${c}"/><stop offset="1" stop-color="#70b8e5"/></linearGradient><pattern id="td-dots-${c.slice(1)}" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1.5" fill="${c}"/></pattern><filter id="td-blur-${c.slice(1)}"><feGaussianBlur stdDeviation="24"/></filter></defs><g opacity="${alpha}">${back}</g><g>${top}</g></svg>`;
}
