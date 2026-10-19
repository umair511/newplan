/**
 * PACKAGING & MATH RULES REGISTRY - TYPE DEFINITIONS
 * Permanent single source of truth for all packaging, palletization, stuffing,
 * dimensions, weight, quantity, tolerance, and mathematical rules.
 */

export type RuleCategory = 'MATH' | 'CONT' | 'PACK' | 'HPP' | 'VPP' | 'FILM' | 'TOL';

export type RuleSeverity = 'HARD' | 'SOFT';

export interface PackagingRule {
  /** Unique Rule Identifier (e.g., MATH-001, HPP-004, CONT-001) */
  id: string;
  /** Functional category of the rule */
  category: RuleCategory;
  /**
   * Severity level:
   * - HARD: Immutable constraint. Future AI/code changes MUST NOT violate this.
   *         If a proposed change conflicts with a HARD rule, STOP and report.
   * - SOFT: Operational default or preference; adjustable via configuration/user consent.
   */
  severity: RuleSeverity;
  /** Short descriptive name of the rule */
  name: string;
  /** Detailed statement of the rule */
  description: string;
  /** Exact mathematical formula or formal physical constraint */
  formulaOrConstraint: string;
  /** File and function in current stable code where rule originates */
  source: string;
  /** Physical, logistical, or factory engineering rationale */
  rationale: string;
  /** Documented discrepancies, legacy differences, or ambiguities in existing code */
  ambiguitiesOrNotes?: string;
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  message: string;
  actualValue: any;
  expectedConstraint: string;
  context?: Record<string, any>;
}

export interface RuleValidationResult {
  valid: boolean;
  hasHardViolations: boolean;
  violations: RuleViolation[];
  warnings: RuleViolation[];
}
