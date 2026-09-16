/** Coverage is a rubric value, never a free float: the rubric is what makes two
 *  scorers comparable, and what stops a model splitting hairs at 0.63. */
export const COVERAGE_VALUES = [0, 0.4, 0.7, 1] as const;
export type Coverage = (typeof COVERAGE_VALUES)[number];

export type CheckKind = 'regex';

export interface Check {
  id: string;
  kind: CheckKind;
  pattern: string;
  on_match: Coverage;
  on_miss: Coverage;
}

export interface Dimension {
  id: string;
  weight: number;
  question: string;
  why?: string;
  checks: Check[];
}

export interface Profile {
  id: string;
  version: string;
  threshold: number;
  rubric: Record<string, string>;
  dimensions: Dimension[];
  /** Where this profile was loaded from. Goes into the record, so a reader can
   *  tell which file was in force when the decision was made. */
  source: string;
}

export interface ProfileRule {
  /** Glob-ish path prefixes this profile applies to. Empty means the whole repo. */
  paths: string[];
  profile: string;
}

export interface GateConfig {
  /** Directory holding .spec-gate.yml; all paths resolve from here. */
  root: string;
  source: string;
  defaultProfile: string;
  rules: ProfileRule[];
  recordsDir: string;
  thresholdOverride?: number;
}
