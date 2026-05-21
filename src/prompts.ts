/**
 * Stdin prompting helpers for the `si` CLI.
 *
 * // Why: We deliberately avoid `inquirer` and friends. The two prompts we
 * // actually need (email, 6-digit code) are simple enough that pulling in
 * // a tree of color/spinner deps is unjustified weight. Native readline
 * // also makes it trivial to wire stdin/stdout substitutes for tests.
 *
 * The masked-input mode for the code prompt suppresses terminal echo so
 * a 6-digit access code doesn't end up in shell history or scrollback.
 *
 * @module prompts
 */

import * as readline from 'node:readline';
import { Readable, Writable } from 'node:stream';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Options for {@link promptText}.
 *
 * // Why: Streams are injectable so tests don't need to fake-pipe stdin.
 * // In production the defaults (process.stdin/process.stdout) are correct.
 *
 * @requirement REQ-SI-NF-052
 */
export interface PromptOptions {
  /** Suppress terminal echo. Useful for secrets / one-time codes. */
  mask?: boolean;
  /** Input stream. Defaults to process.stdin. */
  input?: NodeJS.ReadableStream;
  /** Output stream. Defaults to process.stdout. */
  output?: NodeJS.WritableStream;
}

// ─── Core prompt ─────────────────────────────────────────────────────────────

/**
 * Ask the user a single question. Returns the trimmed answer.
 *
 * // Why: One readline interface per prompt to keep the contract simple:
 * // the caller hands in a question, gets back a string. The masking path
 * // disables echo by intercepting the readline output and writing a
 * // mask character (asterisk) in place of each typed character. We don't
 * // hide the trailing newline because users expect to see "prompt: ↵".
 *
 * @requirement REQ-SI-NF-052
 */
export function promptText(
  question: string,
  opts: PromptOptions = {},
): Promise<string> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;

  return new Promise<string>((resolve, reject) => {
    // Why: We write the question ourselves (bypassing readline's prompt
    // machinery) so the captured output reliably contains the prompt
    // text regardless of terminal/no-terminal mode. Then we read a
    // single line. In mask mode we set terminal:false on readline (so
    // it doesn't echo) AND emit one '*' per typed character to a
    // separate output writer. This sidesteps the ANSI cursor-positioning
    // sequences that the terminal:true path interleaves with echoes.
    output.write(question);

    if (opts.mask) {
      const rlMasked = readline.createInterface({
        input: input as Readable,
        // Why: terminal:false means readline does NOT echo input; we get
        // a clean line back without any cursor manipulation. We emit a
        // single masked character per byte read so the user sees feedback.
        terminal: false,
      });
      const maskWrite = (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        // Mask printable chars; let newlines/control sequences through.
        // eslint-disable-next-line no-control-regex
        output.write(text.replace(/[^\x00-\x1f\x7f]/g, '*'));
      };
      const dataHandler = (chunk: Buffer) => maskWrite(chunk);
      (input as Readable).on('data', dataHandler);
      rlMasked.once('line', (line) => {
        (input as Readable).off('data', dataHandler);
        rlMasked.close();
        // Emit a trailing newline so subsequent output starts cleanly.
        output.write('\n');
        resolve(line.trim());
      });
      rlMasked.on('error', reject);
      return;
    }

    const rl = readline.createInterface({
      input: input as Readable,
      output: output as Writable,
      terminal: false,
    });
    rl.once('line', (line) => {
      rl.close();
      resolve(line.trim());
    });
    rl.on('error', reject);
  });
}

// ─── Email + code helpers ────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;
const MAX_RETRIES = 3;

/**
 * Prompt for an email address, re-prompting on invalid shape.
 *
 * // Why: Catching obviously-invalid input here saves a server round-trip.
 * // Bounded retries (3) so a piped /dev/null doesn't infinite-loop.
 *
 * @requirement REQ-SI-NF-052
 */
export async function promptEmail(
  question = 'Email: ',
  opts: PromptOptions = {},
): Promise<string> {
  let last = '';
  for (let i = 0; i < MAX_RETRIES; i++) {
    last = await promptText(question, opts);
    if (EMAIL_REGEX.test(last)) return last.toLowerCase();
    const output = opts.output ?? process.stderr;
    output.write(`  invalid email; please try again\n`);
  }
  throw new Error(`promptEmail: gave up after ${MAX_RETRIES} attempts (last: "${last.slice(0, 40)}")`);
}

/**
 * Prompt for a 6-digit access code, masking input and re-prompting on
 * invalid shape.
 *
 * // Why: The code is short-lived (5-minute TTL on the server) but still
 * // earns masking so it doesn't surface in screenshares or `script(1)`
 * // captures. Validation enforces the exact 6-digit shape the server
 * // currently issues; if SI/I ever widens this we update both sides.
 *
 * @requirement REQ-SI-NF-052
 */
export async function promptCode(
  question = 'Access code: ',
  opts: PromptOptions = {},
): Promise<string> {
  let last = '';
  for (let i = 0; i < MAX_RETRIES; i++) {
    last = await promptText(question, { ...opts, mask: true });
    if (CODE_REGEX.test(last)) return last;
    const output = opts.output ?? process.stderr;
    output.write(`  invalid code (expected 6 digits); please try again\n`);
  }
  throw new Error(`promptCode: gave up after ${MAX_RETRIES} attempts`);
}
