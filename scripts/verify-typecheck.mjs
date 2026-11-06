import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const run = (command, args, cwd = process.cwd()) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const output = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;
const current = run('npx', ['tsc', '--noEmit']);
process.stdout.write(output(current));
if (current.status === 0) process.exit(0);
if (current.signal === 'SIGKILL' || current.status === 137) process.exit(137);
if (current.error || current.signal) process.exit(1);

// Compare diagnostics against the actual origin/main snapshot with identical dependencies.
// No checkout, network fetch, or changes to the user's worktree are necessary.
const baselineDir = mkdtempSync('/tmp/mcphee-verify-typecheck-');
try {
  const archive = join(baselineDir, 'main.tar');
  const archived = run('git', ['archive', '--format=tar', `--output=${archive}`, 'origin/main']);
  if (archived.status !== 0) throw new Error('Cannot establish pre-existing errors: origin/main is unavailable.');
  if (run('tar', ['-xf', archive, '-C', baselineDir]).status !== 0) throw new Error('Cannot extract origin/main.');
  symlinkSync(join(process.cwd(), 'node_modules'), join(baselineDir, 'node_modules'));
  // Supply Next's ambient declarations without sharing generated .next files:
  // sharing them could accidentally make the baseline import changed app code.
  if (existsSync('next-env.d.ts')) writeFileSync(join(baselineDir, 'next-env.d.ts'), readFileSync('next-env.d.ts'));
  const baseline = run('npx', ['tsc', '--noEmit'], baselineDir);
  const baselineOutput = output(baseline);
  writeFileSync('.verify/logs/typecheck-origin-main.log', baselineOutput);
  if (baseline.signal === 'SIGKILL' || baseline.status === 137) process.exitCode = 137;
  else {
    // Include continuation lines, so a changed diagnostic with the same first line cannot pass.
    const diagnostics = (value) => [...value.matchAll(/^.*error TS\d+:[\s\S]*?(?=^.*error TS\d+:|$(?![\s\S]))/gm)].map(match => match[0].trim());
    const errors = diagnostics(output(current));
    const existing = new Set(diagnostics(baselineOutput));
    if (baseline.status !== null && baseline.status !== 0 && errors.length && errors.every(error => existing.has(error))) {
      console.log('\nPRE-EXISTING: every current TypeScript error is also present on origin/main.');
      console.log('Baseline evidence: .verify/logs/typecheck-origin-main.log');
    } else {
      console.error('\nTypeScript failed with new or unverified errors; see .verify/logs/typecheck-origin-main.log.');
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(baselineDir, { recursive: true, force: true });
}
