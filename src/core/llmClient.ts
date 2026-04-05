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
      // Forcing JSON output based on the agent schema if needed
      // response_format: { type: "json_object" } 
    });

    return response.choices[0]?.message?.content || null;
  }
}
