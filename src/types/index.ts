export interface Config {
  wikiRoot: string;
  llm: {
    provider: 'openai';
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature: number;
  };
  ingest: {
    autoCommit: boolean;
    reviewChanges: boolean;
  };
  paths: {
    raw: string;
    wiki: string;
    templates: string;
  };
}
