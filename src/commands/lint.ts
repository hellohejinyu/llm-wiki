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

// Helper: scan all .md files in a directory recursively
async function scanMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!(await fs.pathExists(dir))) return results;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await scanMdFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(fullPath);
  }
  return results;
}

// Helper: extract all [[links]] from text content
function extractLinks(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim());
}

export default async function lintCmd(config: Config, options: { fix?: boolean, skipLlm?: boolean }) {
  const wikiDir = path.join(config.wikiRoot, config.paths.wiki);
  const indexPath = path.join(wikiDir, 'index.md');

  console.log(chalk.bold.cyan('\n🔍 Running Wiki Lint...\n'));
  
  // ─── Phase 1: Static Analysis ───────────────────────────────────────────────
  console.log(chalk.bold('Phase 1: Static Analysis'));

  const allWikiFiles = await scanMdFiles(wikiDir);
  const pageFiles = allWikiFiles.filter(f => !['index.md', 'log.md'].includes(path.basename(f)));
  const pageBasenames = new Set(pageFiles.map(f => path.basename(f, '.md')));

  // Collect all [[links]] referenced throughout the wiki (incl. index)
  const allLinkedNames = new Set<string>();
  for (const file of allWikiFiles) {
    const content = await fs.readFile(file, 'utf8');
    extractLinks(content).forEach(l => allLinkedNames.add(l));
  }

  // 1a. Orphan pages — pages that no other page links to
  const orphans: string[] = [];
  for (const file of pageFiles) {
    const name = path.basename(file, '.md');
    const isLinked = [...allLinkedNames].some(l => l.toLowerCase().replace(/[^a-z0-9]/g, '') === name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (!isLinked) orphans.push(name);
  }

  // 1b. Dead links — [[links]] in the wiki pointing to non-existent pages
  const deadLinks: Array<{file: string, link: string}> = [];
  for (const file of allWikiFiles) {
    const content = await fs.readFile(file, 'utf8');
    const links = extractLinks(content);
    for (const link of links) {
      const linkCanon = link.toLowerCase().replace(/[^a-z0-9]/g, '');
      const exists = [...pageBasenames].some(b => b.toLowerCase().replace(/[^a-z0-9]/g, '') === linkCanon);
      if (!exists) deadLinks.push({ file: path.relative(config.wikiRoot, file), link });
    }
  }

  // 1c. Index gaps — pages that exist but aren't in index.md
  const indexGaps: string[] = [];
  if (await fs.pathExists(indexPath)) {
    const indexContent = await fs.readFile(indexPath, 'utf8');
    const indexLinked = new Set(extractLinks(indexContent).map(l => l.toLowerCase().replace(/[^a-z0-9]/g, '')));
    for (const file of pageFiles) {
      const name = path.basename(file, '.md');
      if (!indexLinked.has(name.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        indexGaps.push(path.relative(config.wikiRoot, file));
      }
    }
  }

  // Print static results
  if (orphans.length === 0) {
    console.log(chalk.green('  ✓ No orphan pages found.'));
  } else {
    console.log(chalk.yellow(`  ⚠ ${orphans.length} orphan page(s) (no incoming links):`));
    orphans.forEach(o => console.log(`    - ${o}`));
  }

  if (deadLinks.length === 0) {
    console.log(chalk.green('  ✓ No dead links found.'));
  } else {
    console.log(chalk.red(`  ✗ ${deadLinks.length} dead link(s) pointing to non-existent pages:`));
    deadLinks.forEach(d => console.log(`    - [[${d.link}]] in ${d.file}`));
  }

  if (indexGaps.length === 0) {
    console.log(chalk.green('  ✓ All pages are indexed.'));
  } else {
    console.log(chalk.yellow(`  ⚠ ${indexGaps.length} page(s) missing from index.md:`));
    indexGaps.forEach(g => console.log(`    - ${g}`));
  }

  // ─── Phase 2: LLM Semantic Analysis ─────────────────────────────────────────
  if (options.skipLlm) {
    console.log(chalk.gray('\n(Skipping LLM analysis — --skip-llm flag set)\n'));
    return;
  }

  console.log(chalk.bold('\nPhase 2: LLM Semantic Analysis'));
  
  const llm = new LLMClient(config);
  const pb = new PromptBuilder();
  const wm = new WikiManager(config);

  const indexContent = await wm.getIndexContent();
  
  // Load all concept pages content
  const conceptDir = path.join(wikiDir, 'concepts');
  const conceptFiles = await scanMdFiles(conceptDir);
  // Also scan answers dir
  const answersDir = path.join(wikiDir, 'answers');
  const answerFiles = await scanMdFiles(answersDir);
  
  const allPageContents: Array<{name: string, content: string}> = [];
  for (const file of [...conceptFiles, ...answerFiles]) {
    try {
      const content = await fs.readFile(file, 'utf8');
      allPageContents.push({ name: path.basename(file, '.md'), content });
    } catch {}
  }

  const spinner = ora('Asking LLM to analyze wiki for contradictions and gaps...').start();
  let report: any = null;

  try {
    const prompt = await pb.buildLintPrompt({ indexContent, pages: allPageContents });
    const response = await llm.chat([{ role: 'user', content: prompt }]);
    spinner.stop();

    if (!response) throw new Error('Empty response from LLM');

    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON in LLM response');

    const rawJson = response.substring(jsonStart, jsonEnd + 1);
    try {
      report = JSON.parse(rawJson);
    } catch {
      report = JSON.parse(jsonrepair(rawJson));
    }
  } catch (err) {
    spinner.fail('LLM analysis failed.');
    console.error(err);
    return;
  }

  // Print LLM results
  if (report.contradictions?.length > 0) {
    console.log(chalk.red(`\n  ✗ ${report.contradictions.length} potential contradiction(s):`));
    report.contradictions.forEach((c: any) => {
      console.log(chalk.red(`    • [${c.pages.join(' vs ')}]`));
      console.log(chalk.gray(`      ${c.description}`));
    });
  } else {
    console.log(chalk.green('  ✓ No semantic contradictions detected.'));
  }

  if (report.missing_concepts?.length > 0) {
    console.log(chalk.yellow(`\n  ⚠ ${report.missing_concepts.length} missing concept(s) suggested:`));
    report.missing_concepts.forEach((m: any) => {
      console.log(chalk.yellow(`    • [[${m.name}]]`));
      console.log(chalk.gray(`      ${m.rationale}`));
    });
  } else {
    console.log(chalk.green('  ✓ No missing concepts detected.'));
  }

  if (report.shallow_pages?.length > 0) {
    console.log(chalk.yellow(`\n  ⚠ ${report.shallow_pages.length} shallow/placeholder page(s):`));
    report.shallow_pages.forEach((s: any) => {
      console.log(chalk.yellow(`    • ${s.name}: ${s.reason}`));
    });
  } else {
    console.log(chalk.green('  ✓ All pages appear to have substantial content.'));
  }

  if (report.index_gaps?.length > 0) {
    const llmGaps = [...new Set([...(report.index_gaps || []).map((g: any) => g.file), ...indexGaps])];
    console.log(chalk.yellow(`\n  ⚠ Index gap suggestions from LLM:`));
    report.index_gaps.forEach((g: any) => {
      console.log(chalk.yellow(`    • ${g.file}`));
      console.log(chalk.gray(`      ${g.suggestion}`));
    });
  }

  console.log('');

  // ─── Phase 3: (Optional) Auto-fix ─────────────────────────────────────────
  const hasFixes = orphans.length > 0 || report.missing_concepts?.length > 0 || indexGaps.length > 0;
  if (!hasFixes) {
    console.log(chalk.green('🎉 Wiki is healthy! Nothing to fix.\n'));
    return;
  }

  let shouldFix = options.fix;
  if (!shouldFix) {
    const confirm = await inquirer.prompt([{
      type: 'confirm',
      name: 'apply',
      message: 'Do you want the LLM to generate and apply fix proposals for the above issues?',
      default: false
    }]);
    shouldFix = confirm.apply;
  }

  if (!shouldFix) {
    console.log(chalk.gray('No fixes applied. Run with --fix to auto-apply.\n'));
    return;
  }

  // Build fix operations: create stub pages for missing concepts + add index entries
  const fixOperations: Array<{type: 'create' | 'update' | 'delete', path: string, content: string}> = [];

  // Auto-create stub pages for missing concepts
  const newConceptEntries: Array<{safeName: string, displayName: string}> = [];
  for (const mc of (report.missing_concepts || [])) {
    const safeName = mc.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const stubPath = `wiki/concepts/${safeName}.md`;
    const exists = await fs.pathExists(path.join(config.wikiRoot, stubPath));
    if (!exists) {
      fixOperations.push({
        type: 'create',
        path: stubPath,
        content: `# ${mc.name}\n\n> [!NOTE]\n> This page was auto-created by \`wiki lint\`. It needs to be filled in.\n\n${mc.rationale}\n`
      });
      newConceptEntries.push({ safeName, displayName: mc.name });
    }
  }

  // Also handle orphaned answer pages not in index
  const answerOrphans = orphans.filter(o => indexGaps.some(g => g.includes(o)));

  // If we have new stubs or orphaned answers to add, update index.md
  if (newConceptEntries.length > 0 || answerOrphans.length > 0) {
    let currentIndex = indexContent;

    // Append new concept stubs to the Concepts section
    if (newConceptEntries.length > 0) {
      const newConceptLines = newConceptEntries
        .map(e => `* [[${e.safeName}|${e.displayName}]] - *(auto-created stub, needs content)*`)
        .join('\n');

      if (currentIndex.includes('## Concepts')) {
        // Find end of Concepts section and insert before next ##
        currentIndex = currentIndex.replace(
          /## Concepts\n([\s\S]*?)(\n## |\n$|$)/,
          (match, body, tail) => `## Concepts\n${body.trimEnd()}\n${newConceptLines}\n${tail}`
        );
      } else {
        currentIndex += `\n\n## Concepts\n${newConceptLines}\n`;
      }
    }

    // Append orphaned answers to an "Answers" section
    if (answerOrphans.length > 0) {
      const newAnswerLines = answerOrphans
        .map(o => `* [[${o}]]`)
        .join('\n');
      if (currentIndex.includes('## Answers')) {
        currentIndex = currentIndex.replace(
          /## Answers\n([\s\S]*?)(\n## |\n$|$)/,
          (match, body, tail) => `## Answers\n${body.trimEnd()}\n${newAnswerLines}\n${tail}`
        );
      } else {
        currentIndex += `\n\n## Answers\n${newAnswerLines}\n`;
      }
    }

    fixOperations.push({
      type: 'update',
      path: 'wiki/index.md',
      content: currentIndex
    });
  }

  if (fixOperations.length === 0) {
    console.log(chalk.gray('\nNo automatic fixes could be generated. Review issues manually.\n'));
    return;
  }

  console.log(chalk.cyan('\nProposed fix operations:'));
  fixOperations.forEach(op => {
    console.log(`  ${chalk.green(`[${op.type.toUpperCase()}]`)} ${op.path}`);
  });

  const confirm2 = await inquirer.prompt([{
    type: 'confirm',
    name: 'apply',
    message: 'Apply these fix operations?',
    default: true
  }]);

  if (confirm2.apply) {
    await wm.executeOperations(fixOperations);
    await wm.appendLog('lint', `Applied ${fixOperations.length} fix(es).`);
    console.log(chalk.green(`\n✔ Applied ${fixOperations.length} fix(es).\n`));
  } else {
    console.log(chalk.gray('Changes discarded.\n'));
  }
}
