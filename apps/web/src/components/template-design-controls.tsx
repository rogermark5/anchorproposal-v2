"use client";
import { useId, useRef, useState, useEffect } from "react";
import {
  Award,
  Briefcase,
  Contact,
  GraduationCap,
  LayoutTemplate,
  Palette,
  Rows3,
  Type,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Sparkles,
  Lightbulb,
  Rocket,
  GripVertical,
} from "lucide-react";
import {
  DESIGN_THEMES,
  ELEMENT_DEFAULTS,
  HEADER_ACCENTS,
  WATERMARKS,
  SECTION_STYLES,
  SECTION_LABELS,
  orderedSections,
  decorationSvg,
  designLabel,
  sectionStyle,
  type ElementDesign,
} from "@anchorproposal/shared";
import { cn } from "@/lib/utils";
import s from "./template-designer-panel.module.css";

export type DesignerTab =
  | "typography"
  | "layout"
  | "colors"
  | "contact"
  | "experience"
  | "education"
  | "certifications"
  | "headline"
  | "expertise"
  | "projects"
  | "sections"
  | "pdf";
type Nested = Record<string, unknown>;
const object = (value: unknown): Nested =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Nested)
    : {};
export const DESIGNER_TABS: {
  key: DesignerTab;
  label: string;
  icon: typeof Type;
}[] = [
  { key: "typography", label: "Typography", icon: Type },
  { key: "layout", label: "Layout", icon: LayoutTemplate },
  { key: "colors", label: "Colors", icon: Palette },
  { key: "contact", label: "Contact", icon: Contact },
  { key: "experience", label: "Experience", icon: Briefcase },
  { key: "education", label: "Education", icon: GraduationCap },
  { key: "certifications", label: "Certifications", icon: Award },
  { key: "headline", label: "Headline", icon: Sparkles },
  { key: "expertise", label: "Expertise", icon: Lightbulb },
  { key: "projects", label: "Projects", icon: Rocket },
  { key: "sections", label: "Sections", icon: Rows3 },
  { key: "pdf", label: "PDF Style", icon: LayoutTemplate },
];
const FONTS = [
  "Georgia",
  "Garamond",
  "Times New Roman",
  "Palatino",
  "Inter",
  "Calibri",
  "Arial",
  "Cambria",
];
function NumberField({
  label,
  value,
  change,
  min = 0,
  max = 1440,
  step = 1,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  change: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <label className={s.field}>
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          if (!event.target.value) return;
          const n = Number(event.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) change(n);
        }}
        onBlur={() => {
          if (!text && placeholder) {
            change(undefined);
            return;
          }
          const n = Number(text),
            next = Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
          setText(String(next));
          change(next);
        }}
      />
    </label>
  );
}
function ColorField({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  const id = useId();
  return (
    <label className={s.field} htmlFor={id}>
      {label}
      <span className={s.color}>
        <input
          id={id}
          aria-label={label + " hex"}
          key={value}
          defaultValue={value.replace("#", "")}
          maxLength={7}
          onBlur={(event) => {
            const next = "#" + event.target.value.replace(/^#/, "");
            if (/^#[0-9a-f]{6}$/i.test(next)) change(next);
            else event.target.value = value.replace("#", "");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <input
          type="color"
          aria-label={label + " picker"}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#1e3a5f"}
          onChange={(event) => change(event.target.value)}
        />
      </span>
    </label>
  );
}
function Alignment({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <fieldset className={s.alignment}>
      <legend>{label}</legend>
      <div>
        {[
          { key: "left", icon: AlignLeft },
          { key: "center", icon: AlignCenter },
          { key: "right", icon: AlignRight },
        ].map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-label={`${label}: ${key}`}
            aria-pressed={value === key}
            className={value === key ? s.active : undefined}
            onClick={() => change(key)}
          >
            <Icon size={15} />
            {key[0].toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
function Miniature({
  accent = "none",
  watermark = "none",
  section = "none",
  color = "#1e3a5f",
  empty = false,
}: {
  accent?: string;
  watermark?: string;
  section?: string;
  color?: string;
  empty?: boolean;
}) {
  return (
    <div className={s.paper} aria-hidden="true">
      <div
        className={s.art}
        dangerouslySetInnerHTML={{
          __html: decorationSvg(accent, watermark, color, 0.19),
        }}
      />
      {empty ? (
        <span className={s.none}>None</span>
      ) : (
        <>
          <div className={s.miniName} />
          {[0, 1].map((index) => (
            <div
              key={index}
              className={s.miniSection}
              style={{ top: `${30 + index * 28}%` }}
            >
              <div
                className={cn(s.miniHeading, s["mini_" + section])}
                style={{
                  color,
                  background: section === "filled-band" ? color : undefined,
                }}
              >
                {section === "numbered" ? (
                  <span>{index + 1}</span>
                ) : [
                    "dot",
                    "square",
                    "diamond",
                    "chevron",
                    "leaf",
                    "icon",
                    "bar",
                    "side-block",
                  ].includes(section) ? (
                  <span>
                    {
                      (
                        {
                          dot: "•",
                          square: "▪",
                          diamond: "◆",
                          chevron: "›",
                          leaf: "◖",
                          icon: "▦",
                          bar: "┃",
                          "side-block": "▌",
                        } as Record<string, string>
                      )[section]
                    }
                  </span>
                ) : null}
                <i
                  style={{
                    background: section === "filled-band" ? "#fff" : color,
                  }}
                />
              </div>
              <b />
              <b />
              <b />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
function Picker({
  title,
  hint,
  values,
  selected,
  choose,
  kind,
  color,
}: {
  title: string;
  hint: string;
  values: readonly string[];
  selected: string;
  choose: (value: string) => void;
  kind: "accent" | "watermark" | "section";
  color: string;
}) {
  return (
    <section className={s.picker} aria-label={title}>
      <h4>{title}</h4>
      <p className={s.hint}>{hint}</p>
      <div className={s.choiceGrid}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`${title}: ${designLabel(value)}`}
            aria-pressed={selected === value}
            className={cn(s.choice, selected === value && s.selected)}
            onClick={() => choose(value)}
          >
            <Miniature
              accent={kind === "accent" ? value : "none"}
              watermark={kind === "watermark" ? value : "none"}
              section={kind === "section" ? value : "none"}
              color={color}
              empty={value === "none"}
            />
            <span>{designLabel(value)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TemplateDesignerPanel({
  tab,
  onTabChange,
  config,
  onChange,
}: {
  tab: DesignerTab;
  onTabChange: (tab: DesignerTab) => void;
  config: Nested;
  onChange: (next: Nested) => void;
}) {
  const typography = object(config.typography),
    colors = object(config.colors),
    layout = object(config.layout),
    styles = object(config.styles),
    contact = object(config.contact),
    pdf = object(config.pdf),
    sections = object(config.sections),
    visibility = object(sections.visibility),
    labels = object(sections.labels),
    headline = object(config.headline),
    expertise = object(config.expertise);
  const order = orderedSections(
      Array.isArray(sections.order)
        ? (sections.order as string[])
        : ["summary", "skills", "experience", "education", "certifications"],
    ),
    drag = useRef<number | null>(null),
    tabId = useId();
  const set = (group: string, key: string, value: unknown) =>
    onChange({
      ...config,
      [group]: { ...object(config[group]), [key]: value },
    });
  const color = (key: string, fallback = "#1e3a5f") =>
    String(colors[key] || fallback);
  const setArt = (key: string, value: unknown) =>
    onChange({ ...config, pdf: { ...pdf, [key]: value, theme: undefined } });
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set("sections", "order", next);
  };
  const toggle = (
    label: string,
    checked: boolean,
    change: (checked: boolean) => void,
  ) => (
    <label className={s.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => change(event.target.checked)}
      />
      {label}
    </label>
  );
  const select = (
    label: string,
    value: string,
    choices: readonly (readonly [string, string])[],
    change: (value: string) => void,
  ) => (
    <label className={s.field}>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        {choices.map(([key, text]) => (
          <option value={key} key={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const spacing = (label: string, key: string, fallback: number) => (
    <NumberField
      label={label}
      value={Math.round(Number(layout[key] ?? fallback) * 15)}
      change={(value) => set("layout", key, (value || 0) / 15)}
      max={2400}
    />
  );
  const entryLabels: Record<string, [string, string][]> = {
    experience: [
      ["title", "Job Title"],
      ["company", "Company"],
      ["location", "Location"],
      ["dates", "Dates"],
      ["jobType", "Job Type"],
    ],
    education: [
      ["degree", "Degree"],
      ["institution", "Institution"],
      ["location", "Location"],
      ["dates", "Dates"],
    ],
    certifications: [
      ["name", "Certificate Name"],
      ["issuer", "Issuer"],
      ["date", "Issue Date"],
    ],
    projects: [
      ["name", "Project Name"],
      ["url", "Project Link"],
      ["technologies", "Technologies"],
      ["dates", "Dates"],
    ],
  };
  const entryEditor = (group: string) => {
    const entry = object(config[group]),
      elements = object(entry.elements),
      double = entry.layout !== "single";
    const edit = (key: string, field: string, value: unknown) =>
      set(group, "elements", {
        ...elements,
        [key]: { ...object(elements[key]), [field]: value },
      });
    return (
      <>
        <div className={s.row}>
          {select(
            "Layout",
            String(entry.layout || "double"),
            [
              ["single", "Single Line"],
              ["double", "Double Line"],
            ],
            (value) => set(group, "layout", value),
          )}
          <NumberField
            label="Line Gap (twips)"
            value={Number(entry.lineGap ?? 40)}
            max={720}
            change={(value) => set(group, "lineGap", value)}
          />
          {["experience", "projects"].includes(group) && (
            <NumberField
              label="Bullet Gap (twips)"
              value={Number(entry.bulletGap ?? 60)}
              max={720}
              change={(value) => set(group, "bulletGap", value)}
            />
          )}
        </div>
        <p className={s.hint}>
          Set each element’s line, alignment, visibility, text style and color.
          20 twips = 1 point.
        </p>
        {entryLabels[group].map(([key, label]) => {
          const defaults = ELEMENT_DEFAULTS[group][key],
            el = { ...defaults, ...object(elements[key]) } as ElementDesign;
          const legacyHidden =
              group === "certifications" &&
              ((key === "issuer" && styles.showCertIssuer === false) ||
                (key === "date" && styles.showCertDate === false)),
            shown = el.visible !== false && !legacyHidden;
          return (
            <div className={s.element} key={key}>
              <div className={s.elementTop}>
                <button
                  type="button"
                  aria-label={`${shown ? "Hide" : "Show"} ${group} ${label}`}
                  aria-pressed={shown}
                  className={cn(s.eye, shown && s.eyeOn)}
                  onClick={() => {
                    const next = {
                      ...elements,
                      [key]: { ...object(elements[key]), visible: !shown },
                    };
                    onChange({
                      ...config,
                      [group]: { ...entry, elements: next },
                      ...(group === "certifications"
                        ? {
                            styles: {
                              ...styles,
                              ...(key === "issuer"
                                ? { showCertIssuer: !shown }
                                : key === "date"
                                  ? { showCertDate: !shown }
                                  : {}),
                            },
                          }
                        : {}),
                    });
                  }}
                >
                  {shown ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <strong>{label}</strong>
                <div className={s.elementPosition}>
                  {select(
                    `${label} line`,
                    String(el.line || 1),
                    [
                      ["1", "Line 1"],
                      ["2", "Line 2"],
                    ],
                    (value) => edit(key, "line", Number(value)),
                  )}
                  {select(
                    `${label} alignment`,
                    el.align || "left",
                    [
                      ["left", "Left"],
                      ["right", "Right"],
                    ],
                    (value) => edit(key, "align", value),
                  )}
                </div>
              </div>
              {!double && el.line === 2 && (
                <p className={s.hint}>
                  Placed on the single line in this layout.
                </p>
              )}
              <div className={s.elementBottom}>
                <div className={s.row}>
                  {toggle(`${label} bold`, el.bold === true, (value) =>
                    edit(key, "bold", value),
                  )}
                  {toggle(`${label} italic`, el.italic === true, (value) =>
                    edit(key, "italic", value),
                  )}
                </div>
                <ColorField
                  label={`${label} color`}
                  value={
                    el.color ||
                    color(
                      key === "dates" || key === "location" || key === "jobType"
                        ? "muted"
                        : "heading",
                      "#475569",
                    )
                  }
                  change={(value) => edit(key, "color", value)}
                />
              </div>
            </div>
          );
        })}
        <label className={s.field}>
          Element Separator
          <input
            aria-label="Element Separator"
            maxLength={12}
            value={String(entry.separator ?? "•")}
            onChange={(event) => set(group, "separator", event.target.value)}
          />
        </label>
        {group === "projects" && (
          <p className={s.hint}>
            Add project details through Applications → Preview → Edit documents.
            Empty project sections are omitted.
          </p>
        )}
      </>
    );
  };
  return (
    <div className={s.panel} data-testid="template-designer">
      <div role="tablist" aria-label="Template settings" className={s.tabs}>
        {DESIGNER_TABS.map((item) => (
          <button
            key={item.key}
            id={`${tabId}-${item.key}`}
            role="tab"
            aria-selected={tab === item.key}
            aria-controls={`${tabId}-panel`}
            tabIndex={tab === item.key ? 0 : -1}
            type="button"
            onClick={() => onTabChange(item.key)}
            onKeyDown={(event) => {
              if (
                ["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const i = DESIGNER_TABS.findIndex((t) => t.key === tab),
                  next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? DESIGNER_TABS.length - 1
                        : (i +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            DESIGNER_TABS.length) %
                          DESIGNER_TABS.length;
                onTabChange(DESIGNER_TABS[next].key);
                document
                  .getElementById(`${tabId}-${DESIGNER_TABS[next].key}`)
                  ?.focus();
              }
            }}
          >
            <item.icon size={16} />
            {item.label}
          </button>
        ))}
      </div>
      <div
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${tab}`}
        className={s.body}
      >
        {tab === "typography" && (
          <>
            <div className={s.two}>
              {select(
                "Body Font",
                String(typography.bodyFont || "Inter"),
                FONTS.map((font) => [font, font] as const),
                (value) => set("typography", "bodyFont", value),
              )}
              {select(
                "Heading Font",
                String(
                  typography.headingFont || typography.bodyFont || "Inter",
                ),
                FONTS.map((font) => [font, font] as const),
                (value) => set("typography", "headingFont", value),
              )}
            </div>
            <div className={s.two}>
              {[
                ["nameSize", "Name Size (pt)", 20],
                ["headingSize", "Heading Size (pt)", 12],
                ["baseFontSize", "Body Size (pt)", 11],
                ["contactSize", "Contact Size (pt)", 9],
                ["subtextSize", "Sub-text Size (pt)", 9],
              ].map(([key, label, fallback]) => (
                <NumberField
                  key={String(key)}
                  label={String(label)}
                  value={Number(typography[String(key)] ?? fallback)}
                  min={6}
                  max={key === "nameSize" ? 48 : 24}
                  step={0.5}
                  change={(value) => set("typography", String(key), value)}
                />
              ))}
            </div>
            <NumberField
              label="Letter spacing (px)"
              value={Number(typography.letterSpacing ?? 0)}
              max={3}
              step={0.1}
              change={(value) => set("typography", "letterSpacing", value)}
            />
            <div className={s.row}>
              {toggle(
                "Name uppercase",
                Boolean(typography.nameUppercase),
                (value) => set("typography", "nameUppercase", value),
              )}
              {toggle(
                "Heading uppercase",
                typography.headingUppercase !== false,
                (value) => set("typography", "headingUppercase", value),
              )}
            </div>
          </>
        )}
        {tab === "layout" && (
          <>
            <div className={s.two}>
              {select(
                "Header Alignment",
                String(layout.headerAlignment || "left"),
                [
                  ["left", "Left"],
                  ["center", "Center"],
                  ["right", "Right"],
                ],
                (value) => set("layout", "headerAlignment", value),
              )}
              <label className={s.field}>
                Contact Separator
                <input
                  maxLength={12}
                  value={String(layout.contactSeparator ?? "•")}
                  onChange={(event) =>
                    set("layout", "contactSeparator", event.target.value)
                  }
                />
              </label>
              <NumberField
                label="Line spacing (%)"
                value={Math.round(Number(typography.lineHeight ?? 1.4) * 100)}
                min={100}
                max={220}
                step={5}
                change={(value) =>
                  set("typography", "lineHeight", (value || 100) / 100)
                }
              />
              {spacing("Section Spacing (twips)", "sectionSpacing", 16)}
              {spacing("Name-Contact Gap (twips)", "nameContactGap", 6)}
            </div>
            <hr />
            {select(
              "Page Size",
              String(layout.pageSize || "LETTER"),
              [
                ["LETTER", "Letter (8.5 × 11 in)"],
                ["A4", "A4 (210 × 297 mm)"],
              ],
              (value) => set("layout", "pageSize", value),
            )}
            <div>
              <p className={s.fieldTitle}>
                Page Margins (twips, 720 = 0.5 inch)
              </p>
              <div className={s.four}>
                {[
                  ["marginTop", "Top", 36],
                  ["marginBottom", "Bottom", 36],
                  ["marginLeft", "Left", 48],
                  ["marginRight", "Right", 48],
                ].map(([key, label, fallback]) => (
                  <NumberField
                    key={String(key)}
                    label={String(label)}
                    value={Math.round(
                      Number(layout[String(key)] ?? fallback) * 15,
                    )}
                    min={420}
                    max={1800}
                    change={(value) =>
                      set("layout", String(key), (value || 420) / 15)
                    }
                  />
                ))}
              </div>
            </div>
            <hr />
            {select(
              "Section Heading Line Style",
              String(styles.headingLineStyle || "none"),
              [
                ["none", "None"],
                ["full", "Full Rule"],
                ["short", "Short Rule"],
                ["double", "Double Rule"],
              ],
              (value) => set("styles", "headingLineStyle", value),
            )}
            <p className={s.hint}>
              Adds a line beneath each section heading. Page borders stay off.
            </p>
            <div className={s.two}>
              <ColorField
                label="Line Color"
                value={String(
                  styles.headingLineColor || colors.accent || "#1e3a5f",
                )}
                change={(value) => set("styles", "headingLineColor", value)}
              />
              <NumberField
                label="Thickness (1/8 pt)"
                value={Number(styles.headingLineThickness ?? 8)}
                min={1}
                max={32}
                change={(value) => set("styles", "headingLineThickness", value)}
              />
              <NumberField
                label="Spacing After (twips)"
                value={Number(styles.headingLineSpacing ?? 60)}
                max={720}
                change={(value) => set("styles", "headingLineSpacing", value)}
              />
            </div>
            <hr />
            <div className={s.two}>
              {select(
                "Skills layout",
                String(styles.skillsLayout || "comma"),
                [
                  ["comma", "Category: items"],
                  ["lines", "One category per line"],
                  ["bullets", "Bullet list"],
                ],
                (value) => set("styles", "skillsLayout", value),
              )}
              {select(
                "Bullet style",
                String(styles.listStyle || "disc"),
                [
                  ["disc", "Disc"],
                  ["circle", "Circle"],
                  ["square", "Square"],
                  ["dash", "Dash"],
                  ["none", "None"],
                ],
                (value) => set("styles", "listStyle", value),
              )}
            </div>
          </>
        )}
        {tab === "colors" && (
          <>
            <p className={s.hint}>
              Choose a hex color or use a swatch. Accent color also updates
              decorative effects.
            </p>
            <div className={s.two}>
              {[
                ["primary", "Candidate Name", "#1e3a5f"],
                ["heading", "Section Headings", "#1e293b"],
                ["body", "Body Text", "#334155"],
                ["accent", "Accent", "#1e3a5f"],
                ["contact", "Contact Text", "#475569"],
                ["muted", "Secondary Text", "#64748b"],
                ["sectionLabelBg", "Section Background", "#e8eef5"],
                ["sectionLabelText", "Section Label Text", "#1e293b"],
              ].map(([key, label, fallback]) => (
                <ColorField
                  key={key}
                  label={label}
                  value={color(key, fallback)}
                  change={(value) => set("colors", key, value)}
                />
              ))}
            </div>
          </>
        )}
        {tab === "contact" && (
          <>
            {select(
              "Layout",
              String(contact.layout || "single"),
              [
                ["single", "Single Line"],
                ["stacked", "Double Line"],
              ],
              (value) =>
                onChange({
                  ...config,
                  contact: {
                    ...contact,
                    layout: value,
                    elements: Object.keys(object(contact.elements)).length
                      ? contact.elements
                      : {
                          email: { line: 1 },
                          phone: { line: 1 },
                          location: { line: 2 },
                          linkedin: { line: 2 },
                          links: { line: 2 },
                        },
                  },
                }),
            )}
            <p className={s.hint}>
              Configure position, line, color and visibility for contact
              elements.
            </p>
            {toggle(
              "Show job title below candidate name",
              contact.showJobTitle !== false,
              (value) => set("contact", "showJobTitle", value),
            )}
            {[
              ["email", "Email", "showEmail"],
              ["phone", "Phone", "showPhone"],
              ["location", "Location", "showLocation"],
              ["linkedin", "LinkedIn", "showLinkedin"],
              ["links", "Other Links", "showLinks"],
            ].map(([key, label, show]) => {
              const elements = object(contact.elements),
                el = object(elements[key]),
                shown = contact[show] !== false && el.visible !== false;
              const edit = (field: string, value: unknown) =>
                set("contact", "elements", {
                  ...elements,
                  [key]: { ...el, [field]: value },
                });
              return (
                <div className={s.contactRow} key={key}>
                  <button
                    type="button"
                    className={cn(s.eye, shown && s.eyeOn)}
                    aria-label={`${shown ? "Hide" : "Show"} ${label}`}
                    aria-pressed={shown}
                    onClick={() =>
                      onChange({
                        ...config,
                        contact: {
                          ...contact,
                          [show]: !shown,
                          elements: {
                            ...elements,
                            [key]: { ...el, visible: !shown },
                          },
                        },
                      })
                    }
                  >
                    {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <strong>{label}</strong>
                  {contact.layout === "stacked" &&
                    select(
                      `${label} line`,
                      String(el.line || 1),
                      [
                        ["1", "Line 1"],
                        ["2", "Line 2"],
                      ],
                      (value) => edit("line", Number(value)),
                    )}
                  {select(
                    `${label} alignment`,
                    String(el.align || layout.headerAlignment || "center"),
                    [
                      ["left", "Left"],
                      ["center", "Center"],
                      ["right", "Right"],
                    ],
                    (value) => edit("align", value),
                  )}
                  <input
                    type="color"
                    aria-label={`${label} color`}
                    value={String(el.color || colors.contact || "#475569")}
                    onChange={(event) => edit("color", event.target.value)}
                  />
                </div>
              );
            })}
          </>
        )}
        {["experience", "education", "certifications", "projects"].includes(
          tab,
        ) && entryEditor(tab)}
        {tab === "headline" && (
          <>
            <p className={s.hint}>
              Style the professional headline section. Its content can be edited
              in the resume editor. Header job-title visibility is controlled in
              Contact.
            </p>
            <NumberField
              label="Headline Font Size (pt)"
              value={headline.fontSize as number | undefined}
              placeholder="Auto"
              min={6}
              max={36}
              step={0.5}
              change={(value) => set("headline", "fontSize", value)}
            />
            <div className={s.two}>
              <NumberField
                label="Top Gap (twips)"
                value={Number(headline.topGap ?? 0)}
                change={(value) => set("headline", "topGap", value)}
              />
              <NumberField
                label="Bottom Gap (twips)"
                value={Number(headline.bottomGap ?? 120)}
                change={(value) => set("headline", "bottomGap", value)}
              />
            </div>
            <ColorField
              label="Headline Color"
              value={String(headline.color || colors.body || "#334155")}
              change={(value) => set("headline", "color", value)}
            />
            <div className={s.row}>
              {toggle("Bold", headline.bold === true, (value) =>
                set("headline", "bold", value),
              )}
              {toggle("Italic", headline.italic !== false, (value) =>
                set("headline", "italic", value),
              )}
            </div>
            <Alignment
              label="Headline alignment (independent of headings)"
              value={String(headline.alignment || "left")}
              change={(value) => set("headline", "alignment", value)}
            />
          </>
        )}
        {tab === "expertise" && (
          <>
            <p className={s.hint}>
              Choose how Core Expertise is laid out. It uses saved expertise
              entries, or generated skill categories when no entries have been
              added.
            </p>
            {select(
              "Layout",
              String(expertise.layout || "inline"),
              [
                ["inline", "Inline (dot-separated)"],
                ["bullets", "Bullet List"],
                ["grid", "Column Grid"],
              ],
              (value) => set("expertise", "layout", value),
            )}
            {expertise.layout === "grid" && (
              <NumberField
                label="Expertise columns"
                value={Number(expertise.columns ?? 2)}
                min={2}
                max={4}
                change={(value) => set("expertise", "columns", value)}
              />
            )}
          </>
        )}
        {tab === "sections" && (
          <>
            <Alignment
              label="Section heading alignment"
              value={String(sections.headingAlignment || "left")}
              change={(value) => set("sections", "headingAlignment", value)}
            />
            <p className={s.hint}>
              Reorder sections, rename their headings and toggle visibility.
              Drag a handle or use the arrows. Empty sections are omitted.
            </p>
            <div className={s.sectionList}>
              {order.map((key, index) => {
                const shown =
                  visibility[key] !== false &&
                  (!["headline", "expertise"].includes(key) ||
                    visibility[key] === true);
                return (
                  <div
                    className={s.sectionRow}
                    key={key}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (drag.current !== null) reorder(drag.current, index);
                      drag.current = null;
                    }}
                  >
                    <span
                      draggable
                      aria-label={`Drag ${SECTION_LABELS[key]}`}
                      className={s.grip}
                      onDragStart={(event) => {
                        drag.current = index;
                        event.dataTransfer.setData("text/plain", key);
                      }}
                      onDragEnd={() => {
                        drag.current = null;
                      }}
                    >
                      <GripVertical size={16} />
                    </span>
                    <input
                      aria-label={`${SECTION_LABELS[key]} heading`}
                      value={String(labels[key] ?? SECTION_LABELS[key])}
                      maxLength={100}
                      onChange={(event) =>
                        set("sections", "labels", {
                          ...labels,
                          [key]: event.target.value,
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Move ${SECTION_LABELS[key]} up`}
                      disabled={index === 0}
                      onClick={() => reorder(index, index - 1)}
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${SECTION_LABELS[key]} down`}
                      disabled={index === order.length - 1}
                      onClick={() => reorder(index, index + 1)}
                    >
                      <ChevronDown size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`${shown ? "Hide" : "Show"} ${SECTION_LABELS[key]} section`}
                      aria-pressed={shown}
                      className={shown ? s.visible : undefined}
                      onClick={() =>
                        set("sections", "visibility", {
                          ...visibility,
                          [key]: !shown,
                        })
                      }
                    >
                      {shown ? <Eye size={17} /> : <EyeOff size={17} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {tab === "pdf" && (
          <>
            <div className={s.titleRow}>
              <h3>Decorative Shape Effects</h3>
              <span>Applied to preview & PDF</span>
            </div>
            <p className={s.hint}>
              Mix a header accent, a subtle watermark and a section style, or
              choose a professional theme to set all three together. Override
              its accent color in Colors.
            </p>
            <section className={s.picker} aria-label="Professional Themes">
              <h4>Professional Themes</h4>
              <p className={s.hint}>
                One click sets header + watermark + section together.
              </p>
              <div className={s.choiceGrid}>
                {DESIGN_THEMES.map((theme) => {
                  const selected =
                    pdf.headerAccent === theme.accent &&
                    (pdf.watermark || "none") === theme.watermark &&
                    sectionStyle(
                      config as Parameters<typeof sectionStyle>[0],
                    ) === theme.section;
                  return (
                    <button
                      type="button"
                      key={theme.id}
                      aria-label={`Theme: ${theme.label}`}
                      aria-pressed={selected}
                      className={cn(s.choice, selected && s.selected)}
                      onClick={() =>
                        onChange({
                          ...config,
                          pdf: {
                            ...pdf,
                            theme: theme.id,
                            headerAccent: theme.accent,
                            watermark: theme.watermark,
                            sectionStyle: theme.section,
                          },
                          colors: { ...colors, accent: theme.color },
                        })
                      }
                    >
                      <Miniature
                        accent={theme.accent}
                        watermark={theme.watermark}
                        section={theme.section}
                        color={theme.color}
                      />
                      <span>{theme.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <Picker
              title="Header Accent"
              hint="Crisp corner and edge accents at the top of the page."
              values={HEADER_ACCENTS}
              selected={String(pdf.headerAccent || "none")}
              choose={(value) => setArt("headerAccent", value)}
              kind="accent"
              color={color("accent")}
            />
            <Picker
              title="Subtle Watermark"
              hint="Faint background textures behind your content."
              values={WATERMARKS}
              selected={String(pdf.watermark || "none")}
              choose={(value) => setArt("watermark", value)}
              kind="watermark"
              color={color("accent")}
            />
            <NumberField
              label="Watermark strength (%)"
              value={Math.round(Number(pdf.watermarkOpacity ?? 0.12) * 100)}
              min={2}
              max={30}
              change={(value) =>
                setArt("watermarkOpacity", (value || 12) / 100)
              }
            />
            <Picker
              title="Section Style"
              hint="How each section heading is decorated."
              values={SECTION_STYLES}
              selected={sectionStyle(
                config as Parameters<typeof sectionStyle>[0],
              )}
              choose={(value) => setArt("sectionStyle", value)}
              kind="section"
              color={color("accent")}
            />
          </>
        )}
      </div>
    </div>
  );
}
