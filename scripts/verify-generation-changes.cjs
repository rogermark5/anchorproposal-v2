const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp');
fs.mkdirSync(output, { recursive: true });
const log = path.join(output, 'generation-checks.log');
fs.writeFileSync(log, '');
function run(name, args, cwd = root) {
  console.log(`${name}…`);
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const text = `${result.stdout || ''}${result.stderr || ''}`;
  fs.appendFileSync(log, `\n${name}\n${text}`);
  if (result.error || result.status !== 0) { console.error(result.error || text.slice(-14000)); process.exit(result.status || 1); }
  console.log(`${name}: passed`);
}
if (process.argv.includes('--migrate-only')) {
  const load = createRequire(path.join(root, 'apps/api/package.json'));
  const prisma = path.join(path.dirname(load.resolve('prisma/package.json')), 'build/index.js');
  run('Database migration', [prisma, 'migrate', 'deploy'], path.join(root, 'apps/api'));
  process.exit(0);
}
if (process.argv.includes('--web-only')) {
  run('Web type check', ['node_modules/typescript/bin/tsc', '-p', 'apps/web/tsconfig.json', '--noEmit', '--incremental', 'false']);
  const load = createRequire(path.join(root, 'apps/web/package.json'));
  run('Production web build', [load.resolve('next/dist/bin/next'), 'build'], path.join(root, 'apps/web'));
  process.exit(0);
}
run('Shared build', ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.json']);
run('Prisma client check', ['scripts/ensure-prisma-client.cjs'], path.join(root, 'apps/api'));
run('API build', ['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json']);
run('Web type check', ['node_modules/typescript/bin/tsc', '-p', 'apps/web/tsconfig.json', '--noEmit', '--incremental', 'false']);
const tests = fs.readdirSync(path.join(root, 'apps/api/test')).filter(name => name.endsWith('.test.cjs')).map(name => `apps/api/test/${name}`);
run('Unit regression tests', ['--test', '--test-concurrency=2', ...tests]);
if (process.argv.includes('--migrate')) {
  const load = createRequire(path.join(root, 'apps/api/package.json'));
  const prisma = path.join(path.dirname(load.resolve('prisma/package.json')), 'build/index.js');
  run('Database migration', [prisma, 'migrate', 'deploy'], path.join(root, 'apps/api'));
}
if (process.argv.includes('--web-build')) {
  const load = createRequire(path.join(root, 'apps/web/package.json'));
  run('Production web build', [load.resolve('next/dist/bin/next'), 'build'], path.join(root, 'apps/web'));
}
console.log(`Verification log: ${log}`);
