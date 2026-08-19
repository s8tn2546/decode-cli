/**
 * test/integration/session.test.js
 * Integration tests for `decode` interactive session (no argv → startSession).
 * Pipes stdin lines to the child process and checks stdout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/decode.js', import.meta.url));

let tmp;
let globalDir;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-session-it-'));
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-session-global-it-'));
  process.env.DECODE_GLOBAL_CONFIG_DIR = globalDir;
});

afterEach(() => {
  delete process.env.DECODE_GLOBAL_CONFIG_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(globalDir, { recursive: true, force: true });
});

/** Spawn the session with piped stdin lines, wait for exit. */
function runSession(lines) {
  return execa(process.execPath, [CLI], {
    cwd: tmp,
    reject: false,
    input: lines.join('\n') + '\n',
    env: { ...process.env, DECODE_GLOBAL_CONFIG_DIR: globalDir },
  });
}

describe('interactive session startup', () => {
  it('prints banner when spawned with no args', async () => {
    const { stdout } = await runSession(['/exit']);
    expect(stdout).toContain('DeCode Interactive Session');
  });

  it('shows the decode> prompt', async () => {
    const { stdout } = await runSession(['/exit']);
    expect(stdout).toContain('decode>');
  });
});

describe('/help command', () => {
  it('lists available commands', async () => {
    const { stdout } = await runSession(['/help', '/exit']);
    expect(stdout).toContain('/api list');
    expect(stdout).toContain('/status');
    expect(stdout).toContain('/exit');
  });

  it('shows descriptions next to commands', async () => {
    const { stdout } = await runSession(['/help', '/exit']);
    expect(stdout).toContain('List detected API routes');
  });
});

describe('/exit command', () => {
  it('exits cleanly with code 0', async () => {
    const { exitCode } = await runSession(['/exit']);
    expect(exitCode).toBe(0);
  });

  it('prints goodbye message on exit', async () => {
    const { stdout } = await runSession(['/exit']);
    expect(stdout).toContain('Goodbye');
  });
});

describe('unknown slash command', () => {
  it('prints an error but stays in the loop', async () => {
    const { stderr, exitCode } = await runSession(['/notacommand', '/exit']);
    // output.error() writes to stderr
    expect(stderr).toContain('Unknown command');
    expect(exitCode).toBe(0);
  });
});

describe('non-slash input (AI agent seam)', () => {
  it('is silently ignored and loop continues', async () => {
    const { stdout, exitCode } = await runSession(['just some regular text', '/exit']);
    // No error output for non-slash lines — just the prompt again
    expect(stdout).not.toContain('Unknown command');
    expect(exitCode).toBe(0);
  });
});

describe('group-level slash commands', () => {
  it('/api shows api subcommands help', async () => {
    const { stdout } = await runSession(['/api', '/exit']);
    expect(stdout).toContain('/api list');
    expect(stdout).toContain('/api check');
  });

  it('/github shows github subcommands help', async () => {
    const { stdout } = await runSession(['/github', '/exit']);
    expect(stdout).toContain('/github connect');
    expect(stdout).toContain('/github profile');
  });
});

describe('/ask command', () => {
  it('shows help when called with no args', async () => {
    const { stdout, exitCode } = await runSession(['/ask', '/exit']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('/ask');
  });
});

describe('empty input', () => {
  it('re-prompts without error on blank lines', async () => {
    const { stdout, exitCode } = await runSession(['', '   ', '/exit']);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('Unknown command');
  });
});
