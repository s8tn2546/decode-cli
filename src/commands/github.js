/**
 * src/commands/github.js
 * `decode github` group — GitHub activity analysis (PRD story 2).
 *
 * Subcommands: connect, profile, analyze.
 * - connect   verifies the stored token against GET /user (prompting to store
 *             one if absent).
 * - profile   shows the authenticated user's profile + commit record.
 * - analyze   runs the Repo Analyst over a repo's commits, optionally with an
 *             AI plain-English summary (graceful when no LLM is configured).
 */
import inquirer from 'inquirer';
import { Command } from 'commander';
import ora from 'ora';

import {
  getAuthenticatedUser,
  getGithubClient,
  getRepoCommitsDetailed,
  getUserCommitActivity,
  listReposForUser,
  detectCurrentRepo,
  resolveRepoArg,
} from '../services/githubClient.js';
import {
  analyzeActivity,
  analyzeCommits,
  buildProfileSummaryPrompt,
  buildSummaryPrompt,
} from '../services/repoAnalyst.js';
import { generateSummary, isLlmConfigured } from '../services/llmClient.js';
import { saveConnection } from '../services/configStore.js';
import { withPrompt, isInInkSession } from '../ui/ink/promptGuard.js';
import * as output from '../utils/output.js';

export function githubCommand() {
  return new Command('github')
    .description('GitHub activity analysis')
    .addCommand(connectCommand())
    .addCommand(profileCommand())
    .addCommand(analyzeCommand());
}

export async function executeGithubConnect() {
  try {
    const client = getGithubClient();
    const user = await getAuthenticatedUser(client);
    output.success(`Authenticated as ${user.login}${user.name ? ` (${user.name})` : ''}`);
  } catch (err) {
    if (/No GitHub token/.test(err.message)) {
      const { token } = await withPrompt(() => inquirer.prompt([
        {
          type: 'password',
          name: 'token',
          message: 'Paste your GitHub personal access token:',
        },
      ]));
      try {
        saveConnection({ githubToken: token });
        const client = getGithubClient();
        const user = await getAuthenticatedUser(client);
        output.success(`Authenticated as ${user.login}${user.name ? ` (${user.name})` : ''}`);
      } catch (verifyErr) {
        output.error(`GitHub connection failed: ${verifyErr.message}`);
        process.exitCode = 1;
      }
      return;
    }
    output.error(`GitHub connection failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function connectCommand() {
  return new Command('connect')
    .description('Authenticate with GitHub (verifies the stored token)')
    .action(async () => executeGithubConnect());
}

export async function executeGithubProfile(opts) {
  try {
    const client = getGithubClient();
    const user = await getAuthenticatedUser(client);
    const spinner = !isInInkSession() && process.stdout.isTTY ? ora('Fetching your repos and commits...').start() : null;
    let repos = [];
    let activity = { commits: [], detail: [] };
    try {
      repos = await listReposForUser(client, { login: user.login });
      activity = await getUserCommitActivity(client, { login: user.login });
    } finally {
      if (spinner) spinner.stop();
    }

    if (opts.json) {
      output.printJson({
        profile: { login: user.login, name: user.name || null, public_repos: user.public_repos, followers: user.followers },
        repos: repos.slice(0, 10).map((repo) => ({
          repo: repo.full_name,
          language: repo.language,
          lastPush: repo.pushed_at ? repo.pushed_at.slice(0, 10) : null,
        })),
        recentCommits: activity.commits,
      });
      return;
    }

    renderProfile(user, repos, activity);

    // Narrative is grounded in the computed activity metrics — failure still
    // leaves the tables above visible (resilient, like github analyze).
    if (activity.detail.length > 0 && isLlmConfigured()) {
      const metrics = analyzeActivity(activity.detail);
      const prompt = buildProfileSummaryPrompt(metrics, { login: user.login });
      const llmSpinner = !isInInkSession() && process.stdout.isTTY ? ora('Summarizing your activity...').start() : null;
      try {
        const narrative = await generateSummary(prompt, { verbose: opts.verbose });
        output.printBox('Activity narrative', narrative, { borderColor: 'magenta' });
      } catch (err) {
        output.warning(`AI activity summary unavailable (${err.message})`);
      } finally {
        if (llmSpinner) llmSpinner.stop();
      }
    }
  } catch (err) {
    output.error(`github profile failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function profileCommand() {
  return new Command('profile')
    .description('Show your GitHub profile, recent commit record, and an AI activity narrative')
    .option('--json', 'Output machine-readable JSON to stdout')
    .action(async (opts) => executeGithubProfile(opts));
}

function renderProfile(user, repos, activity) {
  output.printBox(
    user.login,
    [
      user.name ? `Name:        ${user.name}` : null,
      user.bio ? `Bio:         ${user.bio}` : null,
      `Public repos: ${user.public_repos}`,
      `Followers:   ${user.followers}`,
      `Following:   ${user.following}`,
      `Profile:     ${user.html_url}`,
    ]
      .filter(Boolean)
      .join('\n'),
    { borderColor: 'green' },
  );

  if (repos.length > 0) {
    output.heading('Recently active repositories');
    output.printTable(
      ['Repo', 'Language', 'Last push'],
      repos.slice(0, 10).map((repo) => [
        `${repo.full_name}`,
        repo.language || '—',
        repo.pushed_at ? new Date(repo.pushed_at).toISOString().slice(0, 10) : '—',
      ]),
    );
  } else {
    output.info('No public repositories found for your account.');
  }

  // Recent commit history pulled from the authenticated user's own activity.
  output.heading('Recent commits');
  if (activity.commits.length > 0) {
    output.printTable(
      ['When', 'Repo', 'Files', 'Message'],
      activity.commits.slice(0, 15).map((c) => [
        c.date,
        c.repo || '—',
        String(c.files),
        truncate(c.message, 42),
      ]),
    );
  } else {
    output.info('No recent commits found across your repositories.');
  }
}

function truncate(text, max) {
  const t = String(text || '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export async function executeGithubAnalyze(repoArg, opts) {
  try {
    const { owner, repo } = repoArg
      ? resolveRepoArg(repoArg)
      : detectCurrentRepo();

    const client = getGithubClient();

    const spinner = !isInInkSession() && process.stdout.isTTY ? ora(`Analyzing ${owner}/${repo}...`).start() : null;
    let commits;
    try {
      commits = await getRepoCommitsDetailed(client, { owner, repo });
    } finally {
      if (spinner) spinner.stop();
    }

    const analysis = analyzeCommits(commits);

    let summary = null;
    if (isLlmConfigured()) {
      const prompt = buildSummaryPrompt(analysis, { owner, repo });
      const llmSpinner = !isInInkSession() && process.stdout.isTTY ? ora('Generating plain-English summary...').start() : null;
      try {
        summary = await generateSummary(prompt, { verbose: opts.verbose });
      } catch (err) {
        summary = null;
        output.warning(`AI summary unavailable (${err.message})`);
      } finally {
        if (llmSpinner) llmSpinner.stop();
      }
    }

    if (opts.json) {
      // summary is null when no LLM is configured or the call failed — the
      // JSON consumer reads that directly (nothing extra pollutes stdout).
      output.printJson({ repo: { owner, repo }, analysis, summary });
      return;
    }

    printHumanResults({ owner, repo }, analysis, summary, commits);
  } catch (err) {
    output.error(`github analyze failed: ${err.message}`);
    process.exitCode = 1;
  }
}

function analyzeCommand() {
  return new Command('analyze')
    .description('Analyze repository activity (defaults to the current repo)')
    .argument('[repo]', 'Repository to analyze as "owner/repo" or a GitHub URL')
    .option('--json', 'Output machine-readable JSON to stdout')
    .option('--verbose', 'Log the exact outgoing LLM request URL and model')
    .action(async (repoArg, opts) => executeGithubAnalyze(repoArg, opts));
}

function printHumanResults({ owner, repo }, analysis, summary, commits) {
  output.heading(`${owner}/${repo}`);
  output.dim(
    `${analysis.totalCommits} commits analyzed` +
      (analysis.dateRange ? ` (${analysis.dateRange.first} → ${analysis.dateRange.last})` : ''),
  );

  if (analysis.contributors.length > 0) {
    output.heading('Contributors');
    output.printTable(
      ['#', 'Contributor', 'Commits'],
      analysis.contributors.map((c, i) => [String(i + 1), c.login, String(c.count)]),
    );
  } else {
    output.info('No contributors found in the analyzed window.');
  }

  output.heading('Commit frequency');
  output.dim('Busiest day(s): ' + (analysis.busiestDays.join(', ') || 'none'));
  output.dim('Daily frequency (most recent 7 days):');
  output.dim(
    analysis.commitFrequency
      .slice(-7)
      .map((d) => `${d.date}: ${d.count}`)
      .join('  '),
  );

  // Heuristic summary is real local signal — always shown, even if the LLM fails.
  printCommitHygiene(analysis.quality, analysis.totalCommits);

  if (summary) {
    output.printBox('Summary', summary, { borderColor: 'magenta' });
  } else if (!isLlmConfigured()) {
    output.dim('No LLM configured — skipping AI summary. Run `decode init` to enable it.');
  }

  if (commits.length >= 500) {
    output.warning('Showing only the most recent ~500 commits.');
  }
}

function printCommitHygiene(quality, totalCommits) {
  if (!quality) return;
  output.heading('Commit hygiene');
  output.dim(`Docs-only commits: ${quality.docsOnlyCount} of ${totalCommits}`);
  output.dim(`Vague / low-quality messages: ${quality.vagueMessageCount}`);
  output.dim(
    `Commit sizes: avg ${quality.avgSize ?? 'n/a'} lines${quality.maxSize != null ? `, largest ${quality.maxSize}` : ''} ` +
      `(over ${quality.scanned} commits with file stats)`,
  );
  if (quality.outliers.length > 0) {
    output.dim(`Size outliers: ${quality.outliers.map((o) => `${o.sha.slice(0, 8)} (+${o.size})`).join(', ')}`);
  }
  output.dim(
    `Commit bursts: ${quality.bursts.length ? quality.bursts.map((b) => `${b.date} (${b.count})`).join(', ') : 'none'}`,
  );
}
