/**
 * test/integration/config.test.js
 * `decode config` end-to-end. Runs the real CLI in a temp cwd; asserts the
 * secret boundary holds (no credentials ever appear in config output or files).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/decode.js', import.meta.url));
const CONFIG_FILE = 'decode.config.json';

let tmp;
let globalDir;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-config-it-'));
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

describe('decode config list', () => {
  it('shows defaults on a fresh project and hides secrets after connecting', async () => {
    const fresh = await run(['config', 'list', '--json']);
    expect(fresh.exitCode).toBe(0);
    expect(JSON.parse(fresh.stdout).llm.provider).toBeNull();

    const connect = await run(['connect', 'sk-super-secret', '--provider', 'openai']);
    expect(connect.exitCode).toBe(0);

    const list = await run(['config', 'list', '--json']);
    expect(list.exitCode).toBe(0);
    const parsed = JSON.parse(list.stdout);
    expect(parsed.llm.provider).toBe('openai');
    expect(parsed.llm.configured).toBe(true);
    // the secret value must never appear in the output
    expect(list.stdout).not.toContain('sk-super-secret');
    expect(parsed.routes).toEqual([]);
  });
});

describe('decode config set', () => {
  it('sets llm.provider and reflects it in list', async () => {
    const set = await run(['config', 'set', 'llm.provider', 'groq']);
    expect(set.exitCode).toBe(0);

    const list = await run(['config', 'list', '--json']);
    expect(JSON.parse(list.stdout).llm.provider).toBe('groq');
  });

  it('rejects secret-looking keys and never writes them to the config file', async () => {
    const set = await run(['config', 'set', 'llm.apiKey', 'sk-secret-value']);
    expect(set.exitCode).toBe(1);
    expect(set.stderr.toLowerCase()).toContain('connect');

    // The rejected set writes nothing: if the config file exists at all it
    // must not contain the secret value.
    const configPath = path.join(tmp, CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      expect(fs.readFileSync(configPath, 'utf8')).not.toContain('sk-secret-value');
    }
  });

  it('rejects unknown key roots', async () => {
    const set = await run(['config', 'set', 'routes.foo', 'x']);
    expect(set.exitCode).toBe(1);
    expect(set.stderr.toLowerCase()).toContain('routes');
  });
});

describe('decode config root resolution from subdirectories', () => {
  it('walks up from a nested cwd to the project-local config, merging global', async () => {
    // Global says groq; the local project overrides to openai.
    const setGlobal = await run(['config', 'set', 'llm.provider', 'groq', '--global']);
    expect(setGlobal.exitCode).toBe(0);
    const setLocal = await run(['config', 'set', 'llm.provider', 'openai', '--local']);
    expect(setLocal.exitCode).toBe(0);

    // Run from a subdirectory like backend/api — resolution should still find
    // the project-local config above it, not the cwd itself.
    const nested = path.join(tmp, 'backend', 'api');
    fs.mkdirSync(nested, { recursive: true });

    const list = await run(['config', 'list', '--json'], { cwd: nested });
    expect(list.exitCode).toBe(0);
    const parsed = JSON.parse(list.stdout);
    expect(parsed.llm.provider).toBe('openai'); // local override found by walk-up
    expect(parsed.llm.providerScope).toBe('local');
  });
});

describe('decode config reset', () => {
  it('resets metadata but keeps .env credentials', async () => {
    // set up: a credential
    await run(['connect', 'sk-key', '--provider', 'openai']);
    fs.writeFileSync(path.join(tmp, '.env'), 'GITHUB_TOKEN=gh-keep-me\nLLM_PROVIDER_API_KEY=sk-key\n', 'utf8');

    const reset = await run(['config', 'reset', '--yes']);
    expect(reset.exitCode).toBe(0);

    const list = await run(['config', 'list', '--json']);
    const parsed = JSON.parse(list.stdout);
    expect(parsed.llm.provider).toBeNull();

    // credentials survive
    expect(fs.readFileSync(path.join(tmp, '.env'), 'utf8')).toContain('GITHUB_TOKEN=gh-keep-me');
  }, 10000);

  it('errors in a non-interactive terminal without --yes', async () => {
    const reset = await run(['config', 'reset']);
    expect(reset.exitCode).toBe(1);
    expect(reset.stderr.toLowerCase()).toContain('--yes');
  });
});
