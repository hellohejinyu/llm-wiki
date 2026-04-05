import fs from 'fs-extra';
import path from 'path';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PromptBuilder {
  private agentSchemaPath: string;
  private ingestTemplatePath: string;

  constructor() {
    this.agentSchemaPath = path.resolve(__dirname, '../schemas/agent.md');
    this.ingestTemplatePath = path.resolve(__dirname, '../schemas/ingest.prompt.hbs');
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
}
