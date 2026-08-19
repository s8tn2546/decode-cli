/**
 * test/integration/ask.test.js
 * `decode ask` end-to-end against a hermetic mock LLM server.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../bin/decode.js', import.meta.url));

describe('decode ask (read-only assistant)', () => {
  let server;
  let baseUrl;
  let tmp;
  let globalDir;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ choices: [{ message: { content: 'mocked answer' } }] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-ask-it-'));
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-global-it-'));
    process.env.DECODE_GLOBAL_CONFIG_DIR = globalDir;
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'ask-fixture', dependencies: {} }));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Ask Fixture\nA test project.');
    fs.writeFileSync(path.join(tmp, 'src', 'index.js'), 'console.log("hi");');
  });

  afterEach(() => {
    delete process.env.DECODE_GLOBAL_CONFIG_DIR;
    delete process.env.LLM_PROVIDER_BASE_URL;
    fs.rmSync(globalDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function run(args, opts = {}) {
    return execa(process.execPath, [CLI, ...args], {
      cwd: tmp,
      reject: false,
      env: { ...process.env, LLM_PROVIDER_BASE_URL: baseUrl },
      ...opts,
    });
  }

  function configureLlm() {
    fs.writeFileSync(path.join(tmp, '.env'), 'LLM_PROVIDER_API_KEY=sk-test\n', 'utf8');
    fs.writeFileSync(
      path.join(tmp, 'decode.config.json'),
      JSON.stringify({ llm: { provider: 'openai', apiKeyRef: 'LLM_PROVIDER_API_KEY' } }),
    );
  }

  it('answers a question and renders through the engine', async () => {
    configureLlm();
    const { exitCode, stdout } = await run(['ask', 'What is this project?']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('mocked answer');
  });

  it('emits valid JSON with --json', async () => {
    configureLlm();
    const { exitCode, stdout } = await run(['ask', 'hello', '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('answer');
  });

  it('falls back gracefully when the LLM call fails', async () => {
    configureLlm();
    const failingServer = http.createServer((req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve));
    const failUrl = `http://127.0.0.1:${failingServer.address().port}`;

    const { exitCode, stdout } = await run(['ask', 'hello'], {
      env: { ...process.env, LLM_PROVIDER_BASE_URL: failUrl },
    });
    expect(exitCode).toBe(1);
    expect(stdout.toLowerCase()).toContain('failed');
    failingServer.closeAllConnections?.();
    return new Promise((resolve) => failingServer.close(resolve));
  });

  it('fails cleanly when no LLM is configured', async () => {
    const { exitCode, stdout } = await run(['ask', 'hello']);
    expect(exitCode).toBe(1);
    expect(stdout.toLowerCase()).toContain('llm');
  });
});
