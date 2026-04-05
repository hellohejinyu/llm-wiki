// Copy non-TS assets from src/schemas into dist/src/schemas after each tsup build
import { cp } from 'fs/promises';
import { existsSync } from 'fs';

const src = 'src/schemas';
const dest = 'dist/src/schemas';

if (existsSync(src)) {
  await cp(src, dest, { recursive: true, force: true });
  console.log(`✔ Copied ${src} → ${dest}`);
} else {
  console.warn(`⚠ ${src} not found, skipping copy`);
}
