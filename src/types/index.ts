export interface Config {
  wikiRoot: string;
  llm: {
    provider: 'openai';
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature: number;
    thinking?: {
      type: 'disabled' | 'enabled';
      budget_tokens?: number;
    };
  };
  paths: {
    raw: string;
    wiki: string;
    templates: string;
  };
}
