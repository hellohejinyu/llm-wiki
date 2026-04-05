#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from '../src/config/loadConfig.ts';
import initCmd from '../src/commands/init.ts';
import rawCmd from '../src/commands/raw.ts';
import ingestCmd from '../src/commands/ingest.ts';
import queryCmd from '../src/commands/query.ts';
import lintCmd from '../src/commands/lint.ts';
import listCmd from '../src/commands/list.ts';

const program = new Command();

async function main() {
  const config = await loadConfig();

  program
    .name('wiki')
    .description('LLM Wiki CLI')
    .version('0.0.1');

  program
    .command('init')
    .description('Initialize a new LLM wiki repository')
    .option('-f, --force', 'Force overwrite existing directories')
    .action((options) => initCmd(config, options));

  program
    .command('raw')
    .description('Add a raw source document interactively')
    .option('--content <text>', 'Direct content input')
    .option('--source <string>', 'Source description')
    .option('--type <type>', 'Type of raw source')
    .option('--no-editor', 'Use terminal to paste directly')
    .action((options) => rawCmd(config, options));

  program
    .command('ingest')
    .description('Ingest raw documents into the wiki')
    .argument('[file]', 'Specific file to ingest')
    .option('--all', 'Ingest all pending files')
    .option('-y, --yes', 'Skip confirmation')
    .option('--dry-run', 'Show logic plan without writing')
    .option('-d, --debug', 'Print debug payload sent to LLM')
    .action((file, options) => ingestCmd(config, file, options));

  program
    .command('query')
    .description('Query the wiki via the LLM')
    .argument('[question]', 'The question')
    .option('--save', 'Save answer without asking')
    .option('--page <name>', 'Name of the saved page')
    .option('--no-save', 'Do not save answer')
    .option('-d, --debug', 'Print debug context info (e.g., accessed pages)')
    .action((question, options) => queryCmd(config, question, options));

  program
    .command('lint')
    .description('Analyze the wiki for inconsistencies or orphans')
    .option('--fix', 'Automatically apply simple fixes')
    .action((options) => lintCmd(config, options));

  program
    .command('list')
    .description('List wiki items')
    .argument('[type]', 'raw / pages / orphans / backlinks', 'pages')
    .argument('[target]', 'Target page for backlinks (optional)', '')
    .action((type, target, options) => listCmd(config, type, target, options));

  program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
