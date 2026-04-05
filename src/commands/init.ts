import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { fileURLToPath } from 'url';
import type { Config } from '../types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function initCmd(config: Config, options: { force?: boolean }) {
  const spinner = ora('Initializing Wiki').start();
  try {
    const rawDir = path.resolve(config.wikiRoot, config.paths.raw, 'untracked');
    const wikiDir = path.resolve(config.wikiRoot, config.paths.wiki);

    const exists = await fs.pathExists(wikiDir) || await fs.pathExists(rawDir);
    if (exists && !options.force) {
      spinner.stop();
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Wiki directories already exist. Overwrite?',
        default: false
      }]);
      if (!confirm) {
        console.log(chalk.yellow('Initialization aborted.'));
        return;
      }
      spinner.start('Re-initializing Wiki');
    }

    // Create directories
    await fs.ensureDir(rawDir);
    await fs.ensureDir(wikiDir);

    // Copy templates explicitly
    const indexDest = path.join(wikiDir, 'index.md');
    const logDest = path.join(wikiDir, 'log.md');
    
    // We assume the CLI has the templates available relative to its install path
    const cliTemplatesDir = path.resolve(__dirname, '../../templates/wiki');
    
    await fs.copy(path.join(cliTemplatesDir, 'index.md'), indexDest, { overwrite: true });
    await fs.copy(path.join(cliTemplatesDir, 'log.md'), logDest, { overwrite: true });

    spinner.succeed(chalk.green('LLM Wiki initialized successfully!'));
  } catch (err) {
    spinner.fail(chalk.red('Initialization failed.'));
    console.error(err);
  }
}
