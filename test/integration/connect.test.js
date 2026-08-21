/**
 * test/integration/connect.test.js
 * `decode connect` / `decode disconnect` end-to-end, incl. status transitions.
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-connect-test-'));
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-global-it-'));
  process.env.DECODE_GLOBAL_CONFIG_DIR = globalDir;
});

afterEach(() => {
  delete process.env.DECODE_GLOBAL_CONFIG_DIR;
  fs.rmSync(globalDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(args, opts = {}) {
  return execa(process.execPath, [CLI, ...args], { cwd: tmp, reject: false, ...opts });
}

describe('decode connect / disconnect', () => {
  it('connect stores a key, status shows it, disconnect removes it', async () => {
    const connect = await run(['connect', 'sk-abc123']);
    expect(connect.exitCode).toBe(0);
    expect(connect.stdout.toLowerCase()).toContain('stored');

    let status = await run(['status']);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain('yes'); // LLM configured
    expect(status.stdout.toLowerCase()).toContain('github');

    const env = fs.readFileSync(path.join(tmp, '.env'), 'utf8');
    expect(env).toContain('LLM_PROVIDER_API_KEY=sk-abc123');

    const disconnect = await run(['disconnect', '--yes']);
    expect(disconnect.exitCode).toBe(0);
    expect(disconnect.stdout.toLowerCase()).toContain('removed');

    status = await run(['status']);
    expect(status.exitCode).toBe(0);
    expect(status.stdout.toLowerCase()).toContain('no');
    expect(status.stdout.toLowerCase()).toContain('not configured');
  }, 10000);
});
