import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-spin-mutation-'));
const source = readFileSync(join(root, 'formal', 'opaque_flow.pml'), 'utf8');
const mutations = [
  {
    name: 'late protected upstream value becomes client-visible',
    oldBlock: `:: action = LateUpstreamOutput;
           /* Once protected handling starts, unsolicited output is suppressed. */
           if
           :: protected_data_handled -> skip
           :: else -> skip
           fi`,
    mutatedBlock: `:: action = LateUpstreamOutput;
           /* Deliberate bug: protected values escape through late output. */
           if
           :: protected_data_handled -> client_value_visible = true
           :: else -> skip
           fi`,
  },
  {
    name: 'source credential is copied into the destination domain',
    oldBlock: `:: action = CredentialCopy;
           /* Source and destination environments are separately allowlisted. */
           skip`,
    mutatedBlock: `:: action = CredentialCopy;
           /* Deliberate bug: a source credential crosses authentication domains. */
           credential_crossed = true`,
  },
];

try {
  const results = [];
  for (const [index, mutation] of mutations.entries()) {
    if (!source.includes(mutation.oldBlock)) throw new Error(`formal model mutation anchor changed: ${mutation.name}`);
    const modelPath = join(temporary, `opaque_flow_mutation_${index}.pml`);
    writeFileSync(modelPath, source.replace(mutation.oldBlock, mutation.mutatedBlock));
    const run = spawnSync('spin', ['-run', '-m1000000', modelPath], {
      cwd: temporary,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const errors = Number(output.match(/errors:\s*(\d+)/)?.[1] ?? 0);
    if (errors < 1 || !/assertion violated/.test(output)) {
      console.error(output);
      throw new Error(`Spin did not detect the deliberate mutation: ${mutation.name}`);
    }
    results.push({
      mutation: mutation.name,
      expected: 'at least one assertion violation',
      assertionViolations: errors,
    });
  }
  console.log(JSON.stringify({
    passed: true,
    mutations: results,
    assertionViolations: results.reduce((sum, result) => sum + result.assertionViolations, 0),
  }, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}