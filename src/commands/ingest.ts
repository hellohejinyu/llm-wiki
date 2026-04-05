import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { jsonrepair } from 'jsonrepair';
import { LLMClient } from '../core/llmClient.ts';
import { PromptBuilder } from '../core/promptBuilder.ts';
import { WikiManager } from '../core/wikiManager.ts';
import type { Config } from '../types/index.ts';

export default async function ingestCmd(config: Config, file: string | undefined, options: { all?: boolean, yes?: boolean, dryRun?: boolean, debug?: boolean }) {
  const untrackedDir = path.resolve(config.wikiRoot, config.paths.raw, 'untracked');
  const ingestedDir = path.resolve(config.wikiRoot, config.paths.raw, 'ingested');
  
  if (!(await fs.pathExists(untrackedDir))) {
    console.log(chalk.yellow('No pending raw files found. Directory does not exist.'));
    return;
  }

  // Recursively collect all .md files, returning paths relative to untrackedDir
  async function collectMdFiles(dir: string, base: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await collectMdFiles(path.join(dir, entry.name), relPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(relPath);
      }
    }
    return results;
  }

  const pendingFiles = await collectMdFiles(untrackedDir, '');

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

    let spinner: any = null;
    
    try {
      // Find existing wiki pages related to this new content (keyword matching)
      const relevantPages = await wm.findRelevantPages(rawContent, { topN: 5, minScore: 3 });
      
      if (options.debug && relevantPages.length > 0) {
        console.log(chalk.magenta(`\n[DEBUG] Found ${relevantPages.length} relevant existing pages to pass as context:`));
        relevantPages.forEach(p => console.log(chalk.gray(`  - ${p.title}`)));
      }

      const promptText = await pb.buildIngestPrompt({
        sourcePath: `raw/ingested/${selectedFile}`,
        rawContent,
        indexContent,
        relevantPages
      });

      if (options.debug) {
         console.log(chalk.magenta('\n[DEBUG] Submitting the following payload to LLM:\n'));
         console.log(chalk.gray(promptText));
         console.log(chalk.magenta('\n[DEBUG] Awaiting LLM response...'));
      }

      spinner = ora('Generating wiki operations via LLM...').start();
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
      
      let plan: any;
      try {
        plan = JSON.parse(rawJson);
      } catch (parseErr) {
        console.log(chalk.yellow('\n[DEBUG] LLM JSON malformed, attempting automatic repair using jsonrepair...'));
        try {
           const repairedJson = jsonrepair(rawJson);
           plan = JSON.parse(repairedJson);
        } catch (repairErr) {
           throw new Error("Could not parse or repair JSON operations from LLM response:\n" + rawJson);
        }
      }

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
        
        // Move to ingested, preserving YYYY/MM subdirectory structure
        const destPath = path.join(ingestedDir, selectedFile);
        await fs.ensureDir(path.dirname(destPath));
        await fs.move(rawPath, destPath, { overwrite: true });
        
        const ingestedRelPath = path.relative(config.wikiRoot, destPath);
        console.log(chalk.green(`
✔ Ingested successfully → ${ingestedRelPath}`));
      } else {
        console.log(chalk.yellow(`Skipped ${selectedFile}.`));
      }
    } catch (err) {
      if (spinner) spinner.stop();
      console.error(chalk.red(`\nFailed to ingest ${selectedFile}:`), err);
    }
  }
}
