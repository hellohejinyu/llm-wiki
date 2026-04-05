import fs from 'fs-extra';
import path from 'path';
import { safeWriteFile } from './fileOps.ts';
import type { Config } from '../types/index.ts';

export interface WikiOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
}

export class WikiManager {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  getWikiRoot() {
    return this.config.wikiRoot;
  }

  async getIndexContent(): Promise<string> {
    const indexPath = path.join(this.config.wikiRoot, this.config.paths.wiki, 'index.md');
    try {
      const exists = await fs.pathExists(indexPath);
      if (!exists) return '# Wiki Index\n\nEmpty index.';
      return await fs.readFile(indexPath, 'utf8');
    } catch {
      return '';
    }
  }

  async getPageContents(pageNames: string[]): Promise<Array<{name: string, content: string}>> {
    const results: Array<{name: string, content: string}> = [];
    if (!pageNames || pageNames.length === 0) return results;

    const targetNames = new Set(pageNames.map(n => n.toLowerCase().replace(/\.md$/, '')));
    
    // Recursive search method
    async function scanDir(dir: string) {
      if (!(await fs.pathExists(dir))) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const baseName = entry.name.slice(0, -3).toLowerCase();
          if (targetNames.has(baseName)) {
             try {
                const content = await fs.readFile(fullPath, 'utf8');
                // find the original casing that the user requested
                const originalName = pageNames.find(n => n.toLowerCase().replace(/\.md$/, '') === baseName) || entry.name;
                results.push({ name: originalName, content });
                targetNames.delete(baseName); // Optimization: stop searching once found
             } catch (e) {
                 console.warn(`Failed to read page: ${fullPath}`, e);
             }
          }
        }
      }
    }

    // Search in wiki and raw/ingested
    await scanDir(path.join(this.config.wikiRoot, this.config.paths.wiki));
    await scanDir(path.join(this.config.wikiRoot, this.config.paths.raw, 'ingested'));

    return results;
  }

  async appendLog(action: string, details: string): Promise<void> {
    const logPath = path.join(this.config.wikiRoot, this.config.paths.wiki, 'log.md');
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const logEntry = `\n## [${timestamp}] ${action} | ${details}`;
    
    await fs.ensureFile(logPath);
    await fs.appendFile(logPath, logEntry, 'utf8');
  }

  async executeOperations(ops: WikiOperation[]): Promise<void> {
    for (const op of ops) {
      // Ensure the path is within the wikiroot for basic security
      const absolutePath = path.resolve(this.config.wikiRoot, op.path);
      if (!absolutePath.startsWith(path.resolve(this.config.wikiRoot))) {
        throw new Error(`Path traversal detected: ${op.path}`);
      }

      switch (op.type) {
        case 'create':
        case 'update':
          if (!op.content) throw new Error(`Content missing for op on ${op.path}`);
          await safeWriteFile(absolutePath, op.content);
          break;
        case 'delete':
          await fs.remove(absolutePath);
          break;
        default:
          console.warn(`Unknown operation type: ${op.type}`);
      }
    }
  }
}
