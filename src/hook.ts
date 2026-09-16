import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { loadConfig, ConfigError, MissingConfigError, CONFIG_NAME } from './config.js';
import { ProfileError } from './profile.js';
import { latestAuthorisation } from './record.js';
import type { GateConfig } from './types.js';

/** Claude Code PreToolUse payload. Only the fields the gate actually reads. */
interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; command?: string };
  permission_mode?: string;
}

export interface HookDecision {
  allow: boolean;
  reason?: string;
  /** True when the gate would have blocked but the mode let it through. The point
   *  of shadow mode is that this is visible rather than comfortable. */
  wouldBlock?: boolean;
  mode?: GateConfig['enforce'];
}

/** Paths that must never be gated, or the gate deadlocks itself: the records it
 *  writes, and the config that defines it. */
const ALWAYS_EXEMPT = ['.git'];

export function decide(input: HookInput, now = new Date()): HookDecision {
  const target = input.tool_input?.file_path;
  // Checked before the config is even loaded: repairing a broken gate must never
  // require the gate to be working.
  if (target && basename(resolve(target)) === CONFIG_NAME) return { allow: true };
  const from = target ? dirname(resolve(target)) : resolve(input.cwd ?? process.cwd());

  let config;
  try {
    config = loadConfig(from);
  } catch (e) {
    // No .spec-gate.yml means this repo is not gated. Silence, not obstruction.
    if (e instanceof MissingConfigError) return { allow: true };
    // A broken config is the opposite case. A gate that disables itself on a typo
    // is the silent failure this tool exists to refuse, so it blocks and says why.
    // Editing .spec-gate.yml is always exempt, so the repair is never locked out.
    if (e instanceof ConfigError || e instanceof ProfileError)
      return { allow: false, reason: `spec-gate: the gate is misconfigured and cannot judge this edit. ${(e as Error).message}` };
    throw e;
  }

  if (target) {
    const rel = resolve(target).startsWith(config.root) ? resolve(target).slice(config.root.length + 1) : null;
    if (rel === null) return { allow: true }; // outside the gated repo
    if (rel === '.spec-gate.yml' || rel.startsWith(config.recordsDir) || ALWAYS_EXEMPT.some((p) => rel.startsWith(p)))
      return { allow: true };
  }

  const verdict = judge(config, input, now);
  if (verdict.allow) return { ...verdict, mode: config.enforce };

  if (config.enforce === 'off') return { allow: true, mode: 'off' };
  if (config.enforce === 'shadow') {
    logShadow(config, input, verdict.reason ?? 'would have blocked');
    return { allow: true, wouldBlock: true, reason: verdict.reason, mode: 'shadow' };
  }
  return { ...verdict, mode: 'deny' };
}

/** Writes what the gate would have done, one JSON line per event. A log the loop
 *  cannot silently drop: if this throws, the hook still allows, but the failure is
 *  on stderr rather than swallowed. */
function logShadow(config: GateConfig, input: HookInput, reason: string): void {
  const path = resolve(config.root, config.shadowLog);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({
        at: new Date().toISOString(),
        session: input.session_id ?? null,
        tool: input.tool_name ?? null,
        file: input.tool_input?.file_path ?? null,
        would_block: true,
        reason,
      }) + '\n',
    );
  } catch (e) {
    process.stderr.write(`spec-gate: could not write the shadow log: ${(e as Error).message}\n`);
  }
}

function judge(config: GateConfig, input: HookInput, now: Date): HookDecision {
  const record = latestAuthorisation(config, input.session_id);
  if (record) {
    const age = now.getTime() - new Date(String(record.created_at)).getTime();
    const hours = age / 3_600_000;
    // An authorisation is for a piece of work, not a standing permission. Stale is
    // as good as absent.
    if (hours <= 12) return { allow: true };
    return {
      allow: false,
      reason:
        `spec-gate: the last authorising record for this session is ${Math.round(hours)} hours old. ` +
        'Score the current request with score_request and write a fresh record before editing.',
    };
  }

  return {
    allow: false,
    reason:
      'spec-gate: no decision record authorises this work. Call score_request with the request you were given, ' +
      'score each dimension against the rubric quoting evidence from the request, put any open questions to the user, ' +
      'then call write_record. To proceed below the threshold, write_record accepts an override with a written reason. ' +
      'Editing without a record is what this gate exists to prevent.',
  };
}

export async function runHook(stdin: NodeJS.ReadableStream = process.stdin): Promise<number> {
  const raw = await read(stdin);
  let input: HookInput;
  try {
    input = JSON.parse(raw) as HookInput;
  } catch {
    // A hook that cannot read its input must not silently authorise everything.
    process.stderr.write('spec-gate: could not parse hook input\n');
    return 1;
  }

  const decision = decide(input);
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...(decision.allow ? {} : { permissionDecision: 'deny', permissionDecisionReason: decision.reason }),
      // Shadow mode still tells the agent what a real gate would have said. Silent
      // observation teaches nobody anything.
      ...(decision.wouldBlock
        ? { additionalContext: `spec-gate (shadow mode, not enforcing): this edit would have been blocked. ${decision.reason}` }
        : {}),
    },
  };
  process.stdout.write(JSON.stringify(out));
  return 0;
}

const read = (stream: NodeJS.ReadableStream): Promise<string> =>
  new Promise((res, rej) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (c) => (data += c));
    stream.on('end', () => res(data));
    stream.on('error', rej);
  });
