import type { Coverage, Dimension, Profile } from './types.js';

export interface CheckOutcome {
  /** Highest coverage a declaration may claim for this dimension. */
  ceiling: Coverage;
  /** Coverage the rule establishes on its own, before anything is declared. */
  floor: Coverage;
  matched: boolean;
  checkId: string;
  evidence: string;
}

/** Rules run against the request text, plus the target path if one was given: naming
 *  the file you intend to touch is evidence about scope, wherever it was said. */
export function runChecks(dimension: Dimension, request: string, target?: string): CheckOutcome | null {
  if (!dimension.checks.length) return null;
  const haystack = target ? `${request}\n${target}` : request;

  for (const check of dimension.checks) {
    const matched = new RegExp(check.pattern, 'i').test(haystack);
    if (matched) {
      // A match is necessary, not sufficient: the rule saw a test path, it cannot
      // judge whether that test binds this change. The declaration takes it from here.
      return {
        ceiling: 1,
        floor: check.on_match,
        matched: true,
        checkId: check.id,
        evidence: `rule ${check.id} matched`,
      };
    }
    // A miss is decisive in the other direction. Nothing in the request names a
    // test, so no declaration can claim the tests were considered.
    return {
      ceiling: check.on_miss,
      floor: check.on_miss,
      matched: false,
      checkId: check.id,
      evidence: `rule ${check.id} found nothing in the request`,
    };
  }
  return null;
}

export interface Vetoed {
  coverage: Coverage;
  method: 'deterministic' | 'model';
  evidence: string;
  vetoed: boolean;
}

/** The veto: a declared score is accepted only up to what the rules allow. This is
 *  the difference between a gate and a checklist the caller fills in for itself. */
export function applyVeto(dimension: Dimension, declared: Coverage, declaredEvidence: string, request: string, target?: string): Vetoed {
  const outcome = runChecks(dimension, request, target);
  if (!outcome) return { coverage: declared, method: 'model', evidence: declaredEvidence, vetoed: false };

  if (declared > outcome.ceiling) {
    return {
      coverage: outcome.ceiling,
      method: 'deterministic',
      evidence: `declared ${declared}, capped at ${outcome.ceiling}: ${outcome.evidence}`,
      vetoed: true,
    };
  }
  return { coverage: declared, method: outcome.matched ? 'model' : 'deterministic', evidence: declaredEvidence, vetoed: false };
}

/** What the rules can say before anything is declared, used by score_request. */
export function prescore(profile: Profile, request: string, target?: string) {
  return profile.dimensions.map((d) => {
    const outcome = runChecks(d, request, target);
    if (!outcome) return { id: d.id, coverage: 0 as Coverage, method: 'unscored' as const, evidence: null, ceiling: 1 as Coverage };
    if (!outcome.matched)
      return { id: d.id, coverage: outcome.floor, method: 'deterministic' as const, evidence: outcome.evidence, ceiling: outcome.ceiling };
    return { id: d.id, coverage: 0 as Coverage, method: 'unscored' as const, evidence: outcome.evidence, ceiling: outcome.ceiling };
  });
}
