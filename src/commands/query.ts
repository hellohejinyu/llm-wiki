import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { LLMClient } from '../core/llmClient.ts';
import { PromptBuilder } from '../core/promptBuilder.ts';
import { WikiManager } from '../core/wikiManager.ts';
import type { Config } from '../types/index.ts';

export default async function queryCmd(config: Config, question: string | undefined, options: { save?: boolean, page?: string, noSave?: boolean }) {
  let finalQuestion = question;
  
  if (!finalQuestion) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'q',
      message: 'What do you want to know about your wiki?'
    }]);
    finalQuestion = answers.q;
  }

  if (!finalQuestion || finalQuestion.trim() === '') {
    console.log(chalk.red('No question provided.'));
    return;
  }

  const llm = new LLMClient(config);
  const pb = new PromptBuilder();
  const wm = new WikiManager(config);

  const indexContent = await wm.getIndexContent();

  const routerSpinner = ora('Routing query and searching index...').start();
  let pagesToRead: string[] = [];

  try {
     const routerPrompt = await pb.buildQueryRouterPrompt({ question: finalQuestion, indexContent });
     const routerResponse = await llm.chat([{ role: 'user', content: routerPrompt }]);
     
     if (routerResponse) {
       const jsonStart = routerResponse.indexOf('[');
       const jsonEnd = routerResponse.lastIndexOf(']');
       if (jsonStart !== -1 && jsonEnd !== -1) {
          pagesToRead = JSON.parse(routerResponse.substring(jsonStart, jsonEnd + 1));
       }
     }
     routerSpinner.succeed(chalk.gray(`Found ${pagesToRead.length} relevant pages to scan.`));
  } catch (err) {
      routerSpinner.fail('Routing failed.');
      console.error(err);
      return;
  }

  const pages = await wm.getPageContents(pagesToRead);
  
  const answerSpinner = ora('Synthesizing answer...').start();
  let answerContent = '';
  try {
      const answerPrompt = await pb.buildQueryAnswerPrompt({ question: finalQuestion, pages });
      const answerResponse = await llm.chat([{ role: 'user', content: answerPrompt }]);
      if (!answerResponse) throw new Error("Empty answer returned");
      answerContent = answerResponse;
      answerSpinner.stop();

      console.log(chalk.cyan(`\n================= ANSWER =================\n`));
      console.log(answerContent);
      console.log(chalk.cyan(`\n==========================================\n`));
      
      await wm.appendLog('query', `Question: "${finalQuestion}" | Pages read: ${pages.length}`);

  } catch (err) {
      answerSpinner.fail('Failed to generate answer.');
      console.error(err);
      return;
  }

  if (options.noSave) return;

  let confirmSave = options.save;
  if (!confirmSave) {
     const savePrompt = await inquirer.prompt([{
       type: 'confirm',
       name: 'save',
       message: 'Do you want to save this answer back into the wiki?',
       default: false
     }]);
     confirmSave = savePrompt.save;
  }

  if (confirmSave) {
     let pageName = options.page;
     if (!pageName) {
        const namePrompt = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: 'Page title:',
          default: 'Research - ' + finalQuestion.substring(0, 20)
        }]);
        pageName = namePrompt.name;
     }

     const safePageName = String(pageName || 'Unnamed');
     const safeName = safePageName.replace(/[/\\?%*:|"<>]/g, '-');
     const fullPageContent = `---\ntitle: "${safePageName}"\ntype: answer\ndate: ${new Date().toISOString()}\n---\n\n# ${safePageName}\n\n**Question:** ${finalQuestion}\n\n${answerContent}`;

     await wm.executeOperations([{
         type: 'create',
         path: `wiki/answers/${safeName}.md`,
         content: fullPageContent
     }]);
     
     console.log(chalk.green(`\n✔ Saved answer to wiki/answers/${safeName}.md`));
  }
}
