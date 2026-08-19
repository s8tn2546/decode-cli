/**
 * src/index.js
 * App bootstrap — registers all commands with commander and parses argv.
 * bin/decode.js imports this file to run the CLI.
 *
 * Router design (ARCHITECTURE.md "High-Level Design"):
 * known commands are matched here; unmatched input will fall through to the
 * AI Agent Fallback (src/commands/agent.js) in a later milestone.
 */
import { Command } from 'commander';

import { NAME, DESCRIPTION, VERSION } from './constants.js';
import { initCommand } from './commands/init.js';
import { connectCommand } from './commands/connect.js';
import { disconnectCommand } from './commands/disconnect.js';
import { statusCommand } from './commands/status.js';
import { apiCommand } from './commands/api.js';
import { githubCommand } from './commands/github.js';
import { docCommand } from './commands/doc.js';
import { configCommand } from './commands/config.js';
import { auditCommand } from './commands/audit.js';
import { askCommand } from './commands/ask.js';
import { agentCommand } from './commands/agent.js';
import { renderLandingScreen } from './commands/help.js';
import { startSession } from './session/session.js';

const program = new Command();

program
  .name(NAME)
  .description(DESCRIPTION)
  .version(VERSION, '-v, --version')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addCommand(initCommand())
  .addCommand(connectCommand())
  .addCommand(disconnectCommand())
  .addCommand(statusCommand())
  .addCommand(apiCommand())
  .addCommand(githubCommand())
  .addCommand(docCommand())
  .addCommand(configCommand())
  .addCommand(auditCommand())
  .addCommand(askCommand())
  .addCommand(agentCommand());

// The built-in help subcommand is replaced by a custom landing screen, so
// re-register `decode help` manually — unknown subcommands now get a suggestion
// via showSuggestionAfterError and a working help command.
program
  .command('help')
  .description('Display DeCode usage and the command list')
  .action(() => {
    program.outputHelp();
  });

program.addHelpCommand(false);
program.on('--help', () => {
  renderLandingScreen();
});

// Start interactive session when no command is provided
if (process.argv.length === 2) {
  startSession();
} else {
  program.parse();
}
