import fs from 'fs-extra';
import path from 'path';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PromptBuilder {
  private agentSchemaPath: string;
  private ingestTemplatePath: string;
  private queryRouterTemplatePath: string;
  private queryAnswerTemplatePath: string;

  constructor() {
    this.agentSchemaPath = path.resolve(__dirname, '../schemas/agent.md');
    this.ingestTemplatePath = path.resolve(__dirname, '../schemas/ingest.prompt.hbs');
    this.queryRouterTemplatePath = path.resolve(__dirname, '../schemas/query_router.prompt.hbs');
    this.queryAnswerTemplatePath = path.resolve(__dirname, '../schemas/query_answer.prompt.hbs');
  }

  async buildIngestPrompt(data: {
    sourcePath: string;
    rawContent: string;
    indexContent: string;
    relevantPages: Array<{ title: string; content: string }>;
  }): Promise<string> {
    const agentSystemPrompt = await fs.readFile(this.agentSchemaPath, 'utf8');
    const ingestTplString = await fs.readFile(this.ingestTemplatePath, 'utf8');

    const template = Handlebars.compile(ingestTplString);
    return template({
      agentSystemPrompt,
      ...data,
    });
  }

  async buildQueryRouterPrompt(data: {
    question: string;
    indexContent: string;
  }): Promise<string> {
    const tplString = await fs.readFile(this.queryRouterTemplatePath, 'utf8');
    const template = Handlebars.compile(tplString);
    return template(data);
  }

  async buildQueryAnswerPrompt(data: {
    question: string;
    pages: Array<{ name: string; content: string }>;
  }): Promise<string> {
    const tplString = await fs.readFile(this.queryAnswerTemplatePath, 'utf8');
    const template = Handlebars.compile(tplString);
    return template(data);
  }
}
