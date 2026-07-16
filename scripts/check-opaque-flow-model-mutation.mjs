import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-spin-mutation-'));
const source = readFileSync(join(root, 'formal', 'opaque_flow.pml'), 'utf8');
const oldBlock = `:: action = LateUpstreamOutput;
           /* Once protected handling starts, unsolicited output is suppressed. */
           if
           :: protected_data_handled -> skip
           :: else -> skip
           fi`;
const mutatedBlock = `:: action = LateUpstreamOutput;
           /* Deliberate bug: protected values escape through late output. */
           if
           :: protected_data_handled -> client_value_visible = true
           :: else -> skip
           fi`;

try {
  if (!source.includes(oldBlock)) throw new Error('formal model mutation anchor changed');
  const modelPath = join(temporary, 'opaque_flow_leak.pml');
  writeFileSync(modelPath, source.replace(oldBlock, mutatedBlock));
  const run = spawnSync('spin', ['-run', '-m1000000', modelPath], {
    cwd: temporary,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const errors = Number(output.match(/errors:\s*(\d+)/)?.[1] ?? 0);
  if (errors < 1 || !/assertion violated/.test(output)) {
    console.error(output);
    throw new Error('Spin did not detect the deliberate transcript leak');
  }
  console.log(JSON.stringify({
    passed: true,
    mutation: 'late protected upstream value becomes client-visible',
    expected: 'at least one assertion violation',
    assertionViolations: errors,
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}