'use client';
export { TemplateDesignerPanel, DESIGNER_TABS } from './template-design-controls';
export type { DesignerTab } from './template-design-controls';
type Nested = Record<string, unknown>;
function asObj(value: unknown): Nested { return value && typeof value === 'object' && !Array.isArray(value) ? value as Nested : {}; }

export function resolveTemplateMeta(
  name: string,
  preset: string | null | undefined,
  config: Nested,
): { description: string; tags: string[] } {
  const meta = asObj(config.meta);
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : [];
  if (meta.description || tags.length) {
    return {
      description: String(meta.description || ''),
      tags,
    };
  }

  const key = (preset || name || '').toLowerCase();
  if (key.includes('modern') || key.includes('minimal')) {
    return {
      description: 'Clean left-aligned layout with subtle spacing. Great for tech.',
      tags: ['Modern', 'Tech'],
    };
  }
  if (key.includes('classic')) {
    return {
      description: 'Traditional format with centered header and clean rules.',
      tags: ['Corporate', 'Traditional'],
    };
  }
  if (key.includes('executive')) {
    return {
      description: 'Commanding presence with a large name and bold dividers.',
      tags: ['Executive', 'Leadership'],
    };
  }
  if (key.includes('compact') || key.includes('technical')) {
    return {
      description: 'Dense layout that fits more content. Skills-first for technical roles.',
      tags: ['Technical', 'Dense'],
    };
  }
  if (key.includes('academic')) {
    return {
      description: 'Scholarly design with serif fonts and generous margins.',
      tags: ['Academic', 'Research'],
    };
  }
  if (key.includes('creative')) {
    return {
      description: 'Elegant with colored dividers and mixed-case headings.',
      tags: ['Creative', 'Design'],
    };
  }
  if (key.includes('startup')) {
    return {
      description: 'Bold and modern with accent colors. Perfect for startups.',
      tags: ['Tech', 'Startup'],
    };
  }
  if (key.includes('federal') || key.includes('gov')) {
    return {
      description: 'Conservative and ATS-friendly. Designed for federal applications.',
      tags: ['Government', 'Federal'],
    };
  }
  if (key.includes('health')) {
    return {
      description: 'Clean and readable format for medical, nursing, and clinical roles.',
      tags: ['Healthcare', 'Medical'],
    };
  }
  if (key.includes('entry') || key.includes('graduate')) {
    return {
      description: 'Education-first layout for new graduates and early-career roles.',
      tags: ['Entry level', 'Graduate'],
    };
  }
  if (key.includes('sales') || key.includes('marketing')) {
    return {
      description: 'Dynamic and results-driven. Ideal for sales and marketing.',
      tags: ['Sales', 'Marketing'],
    };
  }
  if (key.includes('legal')) {
    return {
      description: 'Formal and traditional format for attorneys and legal teams.',
      tags: ['Legal', 'Law'],
    };
  }
  return {
    description: 'Custom resume template for tailored generation.',
    tags: ['Custom'],
  };
}
