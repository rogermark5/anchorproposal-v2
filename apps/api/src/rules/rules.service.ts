import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCompany } from '@anchorproposal/shared';
import { WarningCategory, WarningSeverity, WarningBehavior } from '@prisma/client';
import { contextualWarningText, sentenceContaining, warningSources, WarningSource } from './warning-context';
import { normalizedJobUrl } from '../applications/job-url';

export interface WarningMatch {
  category: WarningCategory;
  matchedText: string;
  severity: WarningSeverity;
  behavior: WarningBehavior;
}

@Injectable()
export class RulesService {
  constructor(private prisma: PrismaService) {}

  private validatePattern(pattern: unknown) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new BadRequestException('Warning pattern is required');
    }
    try { new RegExp(pattern, 'gi'); } catch {
      throw new BadRequestException('Warning pattern must be a valid regular expression');
    }
  }

  async getRules() {
    return this.prisma.warningRule.findMany({ where: { isActive: true } });
  }

  async createRule(data: {
    category: WarningCategory;
    pattern: string;
    severity: WarningSeverity;
    behavior: WarningBehavior;
  }) {
    this.validatePattern(data.pattern);
    return this.prisma.warningRule.create({ data });
  }

  async updateRule(id: string, data: Partial<{ pattern: string; severity: WarningSeverity; behavior: WarningBehavior; isActive: boolean }>) {
    if (data.pattern !== undefined) this.validatePattern(data.pattern);
    return this.prisma.warningRule.update({ where: { id }, data });
  }

  scanText(text: string, rules: Awaited<ReturnType<typeof this.getRules>>): WarningMatch[] {
    const matches: WarningMatch[] = [];

    for (const rule of rules) {
      const regex = new RegExp(rule.pattern, 'gi');
      const match = regex.exec(text);
      if (match?.[0]) {
        matches.push({
          category: rule.category,
          matchedText: sentenceContaining(text, match.index, match[0].length),
          severity: rule.category === WarningCategory.DUPLICATE ? WarningSeverity.CONFIRM : rule.severity,
          behavior: rule.category === WarningCategory.DUPLICATE ? WarningBehavior.CONFIRM : rule.behavior,
        });
      }
    }
    return matches;
  }

  async validateApplication(data: {
    jobTitle: string;
    company: string;
    location?: string;
    workArrangement?: string;
    jobDescription: string;
    profileId: string;
    jobUrl?: string;
    excludeApplicationId?: string;
  }): Promise<{ warnings: WarningMatch[]; duplicates: unknown[] }> {
    const rules = await this.getRules();
    // Prefer the description's actual sentence over a bare work-arrangement field.
    const warnings: WarningMatch[] = [];
    const remaining = new Set(rules.map((rule) => rule.id));
    for (const source of warningSources(data)) {
      for (const rule of rules.filter((item) => remaining.has(item.id))) {
        const found = this.scanText(source, [rule]);
        if (found.length) {
          warnings.push(...found);
          remaining.delete(rule.id);
        }
      }
    }

    const normalized = normalizeCompany(data.company);
    const canonicalUrl = normalizedJobUrl(data.jobUrl);
    const candidates = await this.prisma.application.findMany({
      where: {
        profileId: data.profileId,
        ...(canonicalUrl ? { OR: [{ normalizedCompany: normalized }, { normalizedJobUrl: canonicalUrl }, { normalizedJobUrl: null, jobUrl: { not: null } }] } : { normalizedCompany: normalized }),
        ...(data.excludeApplicationId ? { id: { not: data.excludeApplicationId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        jobTitle: true,
        company: true,
        jobUrl: true,
        normalizedJobUrl: true,
        status: true,
        createdAt: true,
        bidder: { select: { firstName: true, lastName: true } },
      },
    });

    const duplicates = candidates.filter(app => {
      if (normalizeCompany(app.company) === normalized) return true;
      if (!canonicalUrl) return false;
      try { return (app.normalizedJobUrl || normalizedJobUrl(app.jobUrl)) === canonicalUrl; } catch { return false; }
    });

    if (duplicates.length > 0) {
      warnings.push({
        category: WarningCategory.DUPLICATE,
        matchedText: `Duplicate application: this profile already has ${duplicates.length === 1 ? 'an application' : `${duplicates.length} applications`} ${canonicalUrl && duplicates.some(app => { try { return (app.normalizedJobUrl || normalizedJobUrl(app.jobUrl)) === canonicalUrl; } catch { return false; } }) ? 'for this job link' : `to ${data.company}`}, including “${duplicates[0].jobTitle}” (${duplicates[0].status.toLowerCase().replace(/_/g, ' ')}). You can continue and generate a resume.`,
        severity: WarningSeverity.CONFIRM,
        behavior: WarningBehavior.CONFIRM,
      });
    }

    return { warnings, duplicates };
  }

  contextualizeWarnings<T extends { category: string; matchedText: string }>(warnings: T[], data: WarningSource): T[] {
    return warnings.map((warning) => ({
      ...warning, matchedText: contextualWarningText(warning.matchedText, warning.category, data),
      ...(warning.category === 'DUPLICATE' ? { severity: WarningSeverity.CONFIRM, behavior: WarningBehavior.CONFIRM } : {}),
    }));
  }

  canGenerate(warnings: WarningMatch[]): { allowed: boolean; requiresConfirmation: boolean; requiresAdminReview: boolean } {
    const hasBlock = warnings.some((w) => w.category !== WarningCategory.DUPLICATE && w.behavior === WarningBehavior.BLOCK);
    const hasAdminReview = warnings.some((w) => w.category !== WarningCategory.DUPLICATE && w.behavior === WarningBehavior.ADMIN_REVIEW);
    const hasConfirm = warnings.some((w) => w.category === WarningCategory.DUPLICATE || w.behavior === WarningBehavior.CONFIRM);

    return {
      allowed: !hasBlock && !hasAdminReview,
      requiresConfirmation: hasConfirm,
      requiresAdminReview: hasAdminReview,
    };
  }
}
