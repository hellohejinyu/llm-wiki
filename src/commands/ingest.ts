import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { LLMClient } from '../core/llmClient.ts';
import { PromptBuilder } from '../core/promptBuilder.ts';
import { WikiManager } from '../core/wikiManager.ts';
import type { Config } from '../types/index.ts';

export default async function ingestCmd(config: Config, file: string | undefined, options: { all?: boolean, yes?: boolean, dryRun?: boolean }) {
  const untrackedDir = path.resolve(config.wikiRoot, config.paths.raw, 'untracked');
  const ingestedDir = path.resolve(config.wikiRoot, config.paths.raw, 'ingested');
  
  if (!(await fs.pathExists(untrackedDir))) {
    console.log(chalk.yellow('No pending raw files found. Directory does not exist.'));
    return;
  }

  const files = await fs.readdir(untrackedDir);
  const pendingFiles = files.filter(f => f.endsWith('.md'));

  if (pendingFiles.length === 0) {
    console.log(chalk.green('No pending raw files found.'));
    return;
  }

  let selectedFiles: string[] = [];
  
  if (file) {
    selectedFiles = [file];
  } else if (options.all) {
    selectedFiles = pendingFiles;
  } else {
    const { choices } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'choices',
      message: 'Select raw files to ingest:',
      choices: pendingFiles
    }]);
    selectedFiles = choices;
  }

  if (selectedFiles.length === 0) return;

  const llm = new LLMClient(config);
  const pb = new PromptBuilder();
  const wm = new WikiManager(config);

  for (const selectedFile of selectedFiles) {
    console.log(chalk.blue(`\nProcessing ${selectedFile}...`));
    const rawPath = path.join(untrackedDir, selectedFile);
    const rawContent = await fs.readFile(rawPath, 'utf8');
    const indexContent = await wm.getIndexContent();

    const spinner = ora('Generating wiki operations via LLM...').start();
    
    try {
      const promptText = await pb.buildIngestPrompt({
        sourcePath: `raw/ingested/${selectedFile}`,
        rawContent,
        indexContent,
        relevantPages: [] // For MVP, we pass empty. Can be expanded text search later.
      });

      const response = await llm.chat([{ role: 'user', content: promptText }]);
      spinner.stop();

      if (!response) {
        throw new Error("No response from LLM.");
      }

      // Parse JSON from response
      const jsonStart = response.indexOf('{');
      const jsonEnd = response.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
          throw new Error("Could not parse JSON operations from LLM response:\n" + response);
      }

      const rawJson = response.substring(jsonStart, jsonEnd + 1);
      const plan = JSON.parse(rawJson);

      if (!plan.operations || !Array.isArray(plan.operations)) {
        throw new Error("Invalid plan structure from LLM");
      }

      console.log(chalk.cyan(`\nProposed Operations:`));
      plan.operations.forEach((op: any) => {
        const color = op.type === 'create' ? chalk.green : (op.type === 'delete' ? chalk.red : chalk.yellow);
        console.log(`  ${color(`[${op.type.toUpperCase()}]`)} ${op.path}`);
      });

      if (options.dryRun) continue;

      let confirm = options.yes;
      if (!confirm) {
        const answers = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Apply these operations?',
          default: true
        }]);
        confirm = answers.proceed;
      }

      if (confirm) {
        await wm.executeOperations(plan.operations);
        await wm.appendLog('ingest', `Source: ${selectedFile} | Status: success | Msg: ${plan.log_message || 'Ingested'}`);
        
        // Move to ingested
        await fs.ensureDir(ingestedDir);
        await fs.move(rawPath, path.join(ingestedDir, selectedFile), { overwrite: true });
        
        console.log(chalk.green(`\n✔ Ingested successfully.`));
      } else {
        console.log(chalk.yellow(`Skipped ${selectedFile}.`));
      }
    } catch (err) {
      spinner.stop();
      console.error(chalk.red(`\nFailed to ingest ${selectedFile}:`), err);
    }
  }
}
