import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const file = '.verify/last.json';
const now = () => new Date(Date.now() + 8 * 3_600_000).toISOString().replace('Z', '+08:00');
const [command, ...args] = process.argv.slice(2);
if (command === 'start') {
  writeFileSync(file, JSON.stringify({
    level: args[0],
    git_sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    git_dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    started_at: now(), finished_at: null, steps: [], result: 'fail',
  }, null, 2) + '\n');
} else {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (command === 'step') {
    const [name, status, duration, log] = args;
    report.steps.push({ name, status, duration_s: Number(duration), log });
  } else if (command === 'finish') {
    report.finished_at = now();
    report.result = args[0] === '0' ? 'pass' : 'fail';
    console.log('\nStep                         Status         Seconds');
    for (const step of report.steps) console.log(`${step.name.padEnd(28)} ${step.status.padEnd(14)} ${step.duration_s}`);
    console.log(`Result: ${report.result.toUpperCase()} — ${file}`);
  } else throw new Error(`Unknown report command: ${command}`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
}
