/**
 * src/commands/doc.js
 * `decode doc` — documentation generation & freshness (PRD story 3).
 *
 * Forms:
 *  - `decode doc [message]`            generate docs (approval-gated write)
 *  - `decode doc --explain [instruction]` read-only plain-English explanation
 *  - `decode doc check [--json]`       report doc staleness
 *
 * Writing is gated by explicit human approval (AGENTS.md rule 1): the
 * generated content is previewed and confirmed before any file is written.
 * `--yes` is the explicit consent given at invocation (scripting/CI).
 */
import inquirer from 'inquirer';
import ora from 'ora';
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

import { generateArchitecture, explain } from '../services/docGenerator.js';
import { checkDocStaleness } from '../services/docStaleness.js';
import { scanProject } from '../services/projectScanner.js';
import { withPrompt, isInInkSession } from '../ui/ink/promptGuard.js';
import * as output from '../utils/output.js';

const DEFAULT_OUTPUT = 'docs/architecture.md';

export function docCommand() {
  return new Command('doc')
    .description('Generate project documentation or check its freshness')
    .argument('[message]', 'Guidance for the documentation to generate')
    .option('--explain [instruction]', 'Explain the project (or a specific part) in plain English — read-only')
    .option('--yes', 'Confirm the file write without prompting')
    .option('--dry-run', 'Preview the generated documentation without writing')
    .option('--out <path>', `Output file (default: ${DEFAULT_OUTPUT})`)
    .option('--verbose', 'Log the exact outgoing LLM request URL and model')
    .addCommand(checkCommand())
    .action((message, opts) => {
      if (opts.explain !== undefined) {
        return explainFlow(message, opts);
      }
      return executeDoc(message, opts);
    });
}

export function executeDocCheck(opts) {
  try {
    const result = checkDocStaleness();
    if (opts.json) {
      output.printJson(result);
    } else if (result.stale) {
      output.error('Documentation appears stale:');
      for (const file of result.staleSources) output.error(`  ${file} was modified after the docs`);
      output.dim(`Docs: ${result.docFiles.join(', ') || 'none found'}`);
    } else {
      output.success('Documentation is up to date.');
      output.dim(`Docs: ${result.docFiles.join(', ') || 'none found'}`);
    }
    if (result.stale) process.exitCode = 1;
  } catch (err) {
    output.error(`doc check failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function checkCommand() {
  return new Command('check')
    .description('Report whether documentation appears stale relative to recent source changes')
    .option('--json', 'Output machine-readable JSON to stdout')
    .action((opts) => executeDocCheck(opts));
}

export async function executeDoc(message, opts) {
  try {
    const project = scanProject();
    output.dim(`Scanned ${project.tree.length} files across the project.`);

    // Skip the ora spinner inside the Ink session — it writes directly to stdout
    // and would corrupt Ink's renderer. Output still flows via App.jsx capture.
    const spinner = !isInInkSession() && process.stdout.isTTY ? ora('Generating documentation...').start() : null;
    let markdown;
    try {
      markdown = await generateArchitecture(project, { instruction: message, verbose: opts.verbose });
    } finally {
      if (spinner) spinner.stop();
    }

    if (opts.dryRun) {
      console.log(markdown);
      output.dim('Dry run — nothing was written.');
      return;
    }

    previewMarkdown(markdown);

    const target = path.resolve(opts.out || DEFAULT_OUTPUT);
    if (!opts.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        output.error('Non-interactive terminal — pass `--yes` to confirm the write, or `--dry-run` to preview.');
        process.exitCode = 1;
        return;
      }
      const { confirm } = await withPrompt(() => inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Write documentation to ${target}?`,
          default: false,
        },
      ]));
      if (!confirm) {
        output.info('Skipped — nothing was written.');
        return;
      }
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, markdown, 'utf8');
    output.success(`Documentation written to ${target}`);
  } catch (err) {
    output.error(`doc failed: ${err.message}`);
    process.exitCode = 1;
  }
}

async function explainFlow(message, opts) {
  try {
    const instruction = typeof opts.explain === 'string' ? opts.explain : message;
    const project = scanProject();

    const spinner = !isInInkSession() && process.stdout.isTTY ? ora('Explaining the project...').start() : null;
    let text;
    try {
      text = await explain(project, { instruction, verbose: opts.verbose });
    } finally {
      if (spinner) spinner.stop();
    }

    console.log(text);
  } catch (err) {
    output.error(`doc --explain failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function previewMarkdown(markdown) {
  const preview = markdown.length > 800 ? `${markdown.slice(0, 800)}\n… (truncated preview)` : markdown;
  output.printBox('Generated documentation preview', preview, { borderColor: 'yellow' });
}
