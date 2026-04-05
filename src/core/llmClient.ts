import OpenAI from 'openai';
import type { Config } from '../types/index.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMClient {
  private client: OpenAI;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    
    // Fallback to process.env if apiKey is not explicitly in config
    const apiKey = config.llm.apiKey || process.env.OPENAI_API_KEY;
    
    this.client = new OpenAI({
      apiKey,
      baseURL: config.llm.baseUrl, // Essential for proxies
    });
  }

  async chat(messages: ChatMessage[]): Promise<string | null> {
    const response = await this.client.chat.completions.create({
      model: this.config.llm.model,
      messages,
      temperature: this.config.llm.temperature,
      thinking: this.config.llm.thinking,
    } as any);

    return response.choices[0]?.message?.content || null;
  }
}
