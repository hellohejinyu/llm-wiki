import fs from 'fs-extra';
import path from 'path';

/**
 * Atomically writes a file by writing to a temporary file first and renaming.
 */
export async function safeWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);
  
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
        await fs.unlink(tempPath);
    } catch {
        // ignore unlink error
    }
    throw error;
  }
}
