import chalk from 'chalk';
import type { Config } from '../types/index.ts';

export default async function queryCmd(config: Config, question: string | undefined, options: any) {
  console.log(chalk.yellow('query command is not fully implemented yet in MVP.'));
  console.log(`Question intended: ${question}`);
}
