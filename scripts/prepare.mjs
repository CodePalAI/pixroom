import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localTsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const args = ['-p', join(root, 'tsconfig.json')];

rmSync(join(root, 'dist'), { recursive: true, force: true });

let result;
if (existsSync(localTsc)) {
  result = spawnSync(process.execPath, [localTsc, ...args], { cwd: root, stdio: 'inherit' });
} else {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is required to prepare a Git installation');
  result = spawnSync(
    process.execPath,
    [npmCli, 'exec', '--yes', '--package=typescript@5.9.3', '--', 'tsc', ...args, '--noCheck'],
    { cwd: root, stdio: 'inherit' },
  );
}

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);