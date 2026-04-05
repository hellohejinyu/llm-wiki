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

    // Copy core wiki templates explicitly
    const indexDest = path.join(wikiDir, 'index.md');
    const logDest = path.join(wikiDir, 'log.md');
    
    // We assume the CLI has the templates available relative to its install path
    const cliWikiTemplatesDir = path.resolve(__dirname, '../../templates/wiki');
    
    await fs.copy(path.join(cliWikiTemplatesDir, 'index.md'), indexDest, { overwrite: true });
    await fs.copy(path.join(cliWikiTemplatesDir, 'log.md'), logDest, { overwrite: true });

    // Copy configuration and gitignore templates explicitly to the root
    const cliRootTemplatesDir = path.resolve(__dirname, '../../templates');
    const wikircDest = path.join(config.wikiRoot, '.wikirc.json');
    const gitignoreDest = path.join(config.wikiRoot, '.gitignore');
    
    await fs.copy(path.join(cliRootTemplatesDir, '.wikirc.json'), wikircDest, { overwrite: true });
    
    // Only copy gitignore if it doesn't already exist, to avoid breaking existing projects unexpectedly
    if (!(await fs.pathExists(gitignoreDest))) {
      await fs.copy(path.join(cliRootTemplatesDir, '_gitignore'), gitignoreDest);
    } else {
      // Append if it exists, though could be a bit risky. To be safe, just ensure .wikirc.json is ignored.
      const existingGitignore = await fs.readFile(gitignoreDest, 'utf8');
      if (!existingGitignore.includes('.wikirc.json')) {
        await fs.appendFile(gitignoreDest, '\n.wikirc.json\n');
      }
    }

    spinner.succeed(chalk.green('LLM Wiki initialized successfully!'));
  } catch (err) {
    spinner.fail(chalk.red('Initialization failed.'));
    console.error(err);
  }
}
