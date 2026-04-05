import { cosmiconfig } from 'cosmiconfig';
import { defaultConfig } from './defaultConfig.ts';
import type { Config } from '../types/index.ts';

export async function loadConfig(): Promise<Config> {
  const explorer = cosmiconfig('wiki');
  try {
    const result = await explorer.search();
    if (result && !result.isEmpty) {
      // Merge with defaults
      return {
        ...defaultConfig,
        ...result.config,
        llm: {
          ...defaultConfig.llm,
          ...result.config?.llm,
        },
        ingest: {
          ...defaultConfig.ingest,
          ...result.config?.ingest,
        },
        paths: {
          ...defaultConfig.paths,
          ...result.config?.paths,
        },
      };
    }
  } catch (error) {
    console.warn('Failed to load cosmiconfig, using defaults.', error);
  }
  return defaultConfig;
}
