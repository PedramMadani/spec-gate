import { dirname, resolve } from 'node:path';
import { loadConfig, ConfigError } from './config.js';
import { latestAuthorisation } from './record.js';

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
}

/** Paths that must never be gated, or the gate deadlocks itself: the records it
 *  writes, and the config that defines it. */
const ALWAYS_EXEMPT = ['.git'];

export function decide(input: HookInput, now = new Date()): HookDecision {
  const target = input.tool_input?.file_path;
  const from = target ? dirname(resolve(target)) : resolve(input.cwd ?? process.cwd());

  let config;
  try {
    config = loadConfig(from);
  } catch (e) {
    // No .spec-gate.yml means this repo is not gated. Silence, not obstruction.
    if (e instanceof ConfigError) return { allow: true };
    throw e;
  }

  if (target) {
    const rel = resolve(target).startsWith(config.root) ? resolve(target).slice(config.root.length + 1) : null;
    if (rel === null) return { allow: true }; // outside the gated repo
    if (rel === '.spec-gate.yml' || rel.startsWith(config.recordsDir) || ALWAYS_EXEMPT.some((p) => rel.startsWith(p)))
      return { allow: true };
  }

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
