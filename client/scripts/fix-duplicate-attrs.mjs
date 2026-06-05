import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("rg -l '' --glob '*.vue' src dive-common platform", { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

let changed = 0;
for (const file of files) {
  let content = readFileSync(file, 'utf8');
  const original = content;
  content = content.replace(/\s+variant="flat"\s+variant="text"/g, ' variant="text"');
  content = content.replace(/\s+variant="text"\s+variant="flat"/g, ' variant="text"');
  content = content.replace(/\s+density="compact"\s+density="compact"/g, ' density="compact"');
  content = content.replace(/\s+variant="outlined"\s+variant="flat"/g, ' variant="outlined"');
  if (content !== original) {
    writeFileSync(file, content);
    changed += 1;
  }
}
console.log(`Fixed ${changed} files`);
