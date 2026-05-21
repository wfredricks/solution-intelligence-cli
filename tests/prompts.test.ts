/**
 * Tests for src/prompts.ts.
 *
 * // Why: We stream-mock stdin so we don't need a real TTY. The mask test
 * // confirms that the actual typed characters never appear verbatim in
 * // the output stream — only the masked replacements. Re-prompt loops
 * // bound at 3 attempts so a misconfigured terminal can't hang the CLI.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';

import { promptText, promptEmail, promptCode } from '../src/prompts.js';

function makeStreams(linesToType: string[]): {
  input: PassThrough;
  output: PassThrough;
  captured: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  // Feed each "typed line" on its own microtask so readline sees them in order.
  Promise.resolve().then(async () => {
    for (const line of linesToType) {
      input.write(line + '\n');
      // small await so readline gets a chance to process between writes
      await new Promise((r) => setImmediate(r));
    }
  });
  return { input, output, captured: () => Buffer.concat(chunks).toString('utf-8') };
}

describe('promptText', () => {
  it('returns the trimmed answer', async () => {
    const { input, output } = makeStreams(['  alice@x.com  ']);
    const answer = await promptText('Email: ', { input, output });
    expect(answer).toBe('alice@x.com');
  });

  it('in mask mode, output does not contain the raw answer', async () => {
    const { input, output, captured } = makeStreams(['123456']);
    const answer = await promptText('Code: ', { input, output, mask: true });
    expect(answer).toBe('123456');
    // The streamed output must NOT contain "123456".
    expect(captured()).not.toContain('123456');
    // The prompt itself should still appear.
    expect(captured()).toContain('Code:');
  });
});

describe('promptEmail', () => {
  it('lower-cases a valid email', async () => {
    const { input, output } = makeStreams(['Alice@Example.com']);
    const out = await promptEmail('Email: ', { input, output });
    expect(out).toBe('alice@example.com');
  });

  it('re-prompts on invalid then accepts', async () => {
    const { input, output, captured } = makeStreams([
      'not-an-email',
      'alice@example.com',
    ]);
    const out = await promptEmail('Email: ', { input, output });
    expect(out).toBe('alice@example.com');
    expect(captured()).toMatch(/invalid email/);
  });

  it('throws after 3 invalid attempts', async () => {
    const { input, output } = makeStreams(['a', 'b', 'c']);
    await expect(promptEmail('Email: ', { input, output })).rejects.toThrow(
      /gave up after 3/,
    );
  });
});

describe('promptCode', () => {
  it('accepts a 6-digit code and masks its echo', async () => {
    const { input, output, captured } = makeStreams(['654321']);
    const out = await promptCode('Code: ', { input, output });
    expect(out).toBe('654321');
    expect(captured()).not.toContain('654321');
  });

  it('re-prompts on non-6-digit input', async () => {
    const { input, output, captured } = makeStreams(['abc', '12345', '987654']);
    const out = await promptCode('Code: ', { input, output });
    expect(out).toBe('987654');
    expect(captured()).toMatch(/invalid code/);
  });

  it('throws after 3 invalid attempts', async () => {
    const { input, output } = makeStreams(['a', 'b', 'c']);
    await expect(promptCode('Code: ', { input, output })).rejects.toThrow(
      /gave up after 3/,
    );
  });
});
