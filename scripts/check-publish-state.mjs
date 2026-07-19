import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const status = readme.match(/<!-- PINPOINT_NPM_STATUS: (unpublished|development|candidate|published) -->/)?.[1];

if (!['candidate', 'published'].includes(status)) {
  throw new Error('npm publish requires a candidate or published README state');
}
for (const command of [
  `npm install -g ${packageJson.name}@${packageJson.version}`,
  `npm install ${packageJson.name}@${packageJson.version}`,
  `npx ${packageJson.name}@${packageJson.version} demo`,
]) {
  if (!readme.includes(command)) throw new Error(`README is missing release command: ${command}`);
}
console.log(`publish state check: ok (${packageJson.name}@${packageJson.version}, npm=${status})`);