/**
 * src/commands/ask.js
 * `decode ask` — read-only AI assistant (PRD story 4b, distinct from story 5).
 *
 * Forms:
 *  - `decode ask <question>`        one-shot Q&A
 *  - `decode ask --file <path>`     scope context to a specific file
 *  - `decode ask --json`            machine-readable output
 *  - `/ask <question>`              session slash command
 *
 * The assistant never writes, modifies, or deletes files. If a change is
 * requested, it proposes the code in a fenced block with the target path.
 */

import inquirer from 'inquirer';
import { Command } from 'commander';
import ora from 'ora';

import { ASSISTANT_SYSTEM_PROMPT } from '../services/assistantPrompt.js';
import { buildProjectContext, PROJECT_CONTEXT_BUDGET } from '../services/projectContext.js';
import { generateSummary, isLlmConfigured } from '../services/llmClient.js';
import * as ui from '../ui/index.js';
import * as renderer from '../ui/renderer.js';

export function askCommand() {
  return new Command('ask')
    .description('Ask the AI assistant a question about your project (read-only)')
    .argument('[question]', 'Your question about the project')
    .option('--file <path>', 'Scope context to a specific file')
    .option('--json', 'Output machine-readable JSON to stdout')
    .option('--verbose', 'Log the exact outgoing LLM request URL and model')
    .action(async (question, opts) => executeAsk(question, opts));
}

export async function executeAsk(question, opts = {}) {
  try {
    const resolvedQuestion = await resolveQuestion(question, opts);
    if (!resolvedQuestion) return;

    const context = buildProjectContext({ question: resolvedQuestion, file: opts.file });

    if (opts.json) {
      const result = await runAssistant(resolvedQuestion, context, opts);
      renderer.render(JSON.stringify(result, null, 2));
      return;
    }

    await renderInteractiveAsk(resolvedQuestion, context, opts);
  } catch (err) {
    renderError(err);
    process.exitCode = 1;
  }
}

async function resolveQuestion(question, _opts) {
  if (question) return question;
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) {
    renderError(new Error('No question provided. Pass a question argument or run interactively.'));
    return null;
  }
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'question',
      message: 'What do you want to know about this project?',
    },
  ]);
  return answers.question || null;
}

async function runAssistant(question, context, opts) {
  if (!isLlmConfigured()) {
    throw new Error('No LLM provider configured. Run `decode init` to connect your LLM provider.');
  }

  const prompt = [
    ASSISTANT_SYSTEM_PROMPT,
    '',
    '--- PROJECT CONTEXT ---',
    `Budget: ${PROJECT_CONTEXT_BUDGET} characters`,
    `Truncated: ${context.truncated}`,
    `Omitted files: ${context.omittedFiles.join(', ') || 'none'}`,
    '',
    '## Project structure',
    context.structure || '(empty)',
    '',
    '## Dependencies',
    JSON.stringify(context.dependencies, null, 2),
    '',
    '## Files',
    ...context.files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``),
    '',
    '--- END PROJECT CONTEXT ---',
    '',
    `User question: ${question}`,
  ].join('\n');

  const spinner = process.stdout.isTTY ? ora('Thinking...').start() : null;
  let answer;
  try {
    answer = await generateSummary(prompt, { verbose: opts.verbose });
  } finally {
    if (spinner) spinner.stop();
  }

  return { answer, error: null, context };
}

async function renderInteractiveAsk(question, context, opts) {
  const stages = renderer.progressive();
  stages.stage(ui.body('Assembling project context...'));

  const result = await runAssistant(question, context, opts);
  stages.finish();

  const answerBlock = ui.panel({
    title: 'Answer',
    content: result.answer,
    width: 70,
    borderColor: 'cyan',
  });

  const meta = [];
  meta.push(`${ui.statusDot('pass')}  ${context.files.length} file(s) in context`);
  if (context.truncated) {
    meta.push(`${ui.statusDot('warn')}  ${context.omittedFiles.length} file(s) omitted (budget exceeded)`);
  }
  meta.push(`${ui.statusDot('pass')}  ${PROJECT_CONTEXT_BUDGET.toLocaleString()} char budget`);

  const content = [
    answerBlock,
    '',
    '',
    meta.join('\n'),
  ].join('\n');

  renderer.render({
    command: 'decode ask',
    context: '— project assistant',
    content,
  });
}

function renderError(err) {
  const error = ui.errorPrompt({
    type: 'Ask failed',
    explanation: err.message || 'An unexpected error occurred.',
    actions: [
      { command: 'decode status', description: 'check configuration' },
      { command: 'decode init', description: 'connect an LLM provider' },
    ],
  });

  renderer.render({
    type: 'error',
    command: 'decode ask',
    error,
  });
}
