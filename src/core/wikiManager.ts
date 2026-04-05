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

    const canonicalize = (n: string) => n.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

    const targets = pageNames.map(original => ({
        original,
        canon: canonicalize(original.replace(/\.md$/, '')),
        isPath: original.includes('/') || original.includes('.')
    }));
    
    // First, try direct path access for everything that looks like a path
    for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        if (t.isPath) {
            const possiblePaths = [
                path.resolve(this.config.wikiRoot, t.original),
                path.resolve(this.config.wikiRoot, this.config.paths.wiki, t.original),
                path.resolve(this.config.wikiRoot, this.config.paths.raw, 'ingested', t.original)
            ];
            
            for (const p of possiblePaths) {
                if (await fs.pathExists(p)) {
                    try {
                        const content = await fs.readFile(p, 'utf8');
                        results.push({ name: t.original, content });
                        targets.splice(i, 1);
                        break;
                    } catch {}
                }
            }
        }
    }

    if (targets.length === 0) return results;

    // Recursive search method for generic page names
    async function scanDir(dir: string) {
      if (!(await fs.pathExists(dir))) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const baseName = entry.name.slice(0, -3);
          const baseCanon = canonicalize(baseName);
          
          // Check for exact matches first (best quality)
          let matchIndex = targets.findIndex(t => t.canon === baseCanon);
          
          // Fallback to substring matching only if target is not a path-like string
          if (matchIndex === -1) {
              matchIndex = targets.findIndex(t => {
                  if (t.isPath) return false; // Don't fuzzy match paths
                  return t.canon.includes(baseCanon) || baseCanon.includes(t.canon);
              });
          }
          
          const isSafeMatch = matchIndex !== -1 && (
              targets[matchIndex].canon === baseCanon || 
              Math.abs(targets[matchIndex].canon.length - baseCanon.length) > 3
          );

          if (isSafeMatch) {
             try {
                const content = await fs.readFile(fullPath, 'utf8');
                results.push({ name: targets[matchIndex].original, content });
                targets.splice(matchIndex, 1); // Optimization: stop searching this particular target once found
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

  async findRelevantPages(
    rawContent: string,
    options: { topN?: number; minScore?: number } = {}
  ): Promise<Array<{title: string, content: string}>> {
    const { topN = 5, minScore = 2 } = options;
    const wikiDir = path.join(this.config.wikiRoot, this.config.paths.wiki);

    // Extract meaningful words (>3 chars) from the raw content
    const stopWords = new Set(['that', 'this', 'with', 'from', 'they', 'have', 'what', 'when', 'will', 'your', 'into', 'more', 'also', 'just', 'been', 'some', 'than', 'then', 'them', 'were', 'like', 'said', 'each', 'which', 'their', 'there', 'about', 'would', 'these', 'other', 'after', 'using', 'could', 'where', 'those']);
    const rawWords = new Set(
      rawContent.toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w))
    );

    // Recursively scan a directory for .md files and score each page
    const scored: Array<{title: string, content: string, score: number}> = [];

    async function scanAndScore(dir: string) {
      if (!(await fs.pathExists(dir))) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanAndScore(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md') && !['index.md', 'log.md'].includes(entry.name)) {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const pageWords = content.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, ' ').split(/\s+/);
            let score = 0;
            for (const w of pageWords) {
              if (rawWords.has(w)) score++;
            }
            // Bonus: filename keywords matching also count
            const nameWords = entry.name.slice(0, -3).toLowerCase().replace(/[-_]/g, ' ').split(' ');
            for (const w of nameWords) {
              if (w.length > 3 && rawWords.has(w)) score += 3;
            }
            if (score >= minScore) {
              scored.push({ title: entry.name.slice(0, -3), content, score });
            }
          } catch {}
        }
      }
    }

    await scanAndScore(path.join(wikiDir, 'concepts'));
    await scanAndScore(path.join(wikiDir, 'answers'));

    // Sort by score descending and return top N
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(({ title, content }) => ({ title, content }));
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
