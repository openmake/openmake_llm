// Only fixed runner arguments: changed filenames and manifest data never become shell code.
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectE2E } from './feature-checks-e2e.mjs';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./feature-checks.manifest.json', import.meta.url)));
export function selectFeatures(files) {
  const result = { api: [], web: false, pipeline: false, infra: false, bridge: false, hostSetup: false, e2e: selectE2E(files) };
  for (const file of files) {
    if (result.e2e.some(spec => spec.file === file)) continue;
    if (file.startsWith('apps/api/src/') && /\.[cm]?[jt]sx?$/.test(file)) { result.api.push(file); continue; }
    if (manifest.specs[file]) { result[manifest.specs[file]] = true; continue; }
    // Exact host setup files only — a new setup script stays unmapped until it is listed with fixture coverage.
    if (manifest.hostSetup.includes(file)) { result.hostSetup = true; continue; }
    // Exact non-API files with a fixed consumer suite (e.g. type-only shared contracts) — never a package prefix.
    if (manifest.exactFiles[file]) { result[manifest.exactFiles[file]] = true; continue; }
    if (/(?:^|\/)(?:specs|specifications)\//.test(file)) throw new Error(`Unmapped changed spec: ${file}; add a fixed manifest suite`);
    const match = Object.entries(manifest.prefixes).find(([prefix]) => file.startsWith(prefix));
    if (match) { result[match[1]] = true; continue; }
    if (/\.(?:md|html|svg|png|json)$/.test(file) && !file.startsWith('packages/')) continue;
    if (file.startsWith('packages/')) { result.api.push(file); continue; }
    // Unknown executable source requires an explicit mapping instead of silently claiming coverage.
    if (selectE2E([file]).length) continue;
    if (/\.(?:[cm]?[jt]sx?|sh|ya?ml)$/.test(file)) throw new Error(`Unmapped changed source: ${file}`);
  }
  return result;
}
export function requireRelated(source, tests) {
  if (!tests.length) throw new Error(`No related Jest tests for ${source}; add coverage or a fixed mapping`);
  if (tests.some(path => !path.includes('/apps/api/src/') || !/\.(test|spec)\.ts$/.test(path))) throw new Error('Unexpected Jest test selection');
  return tests;
}
export function assertExecuted(related, report) {
  for (const [source, paths] of related) {
    if (!(report.testResults || []).some(result => paths.includes(result.name) && (result.assertionResults || []).some(assertion => assertion.status === 'passed'))) throw new Error(`No executed related tests for ${source} (all skipped or missing)`);
  }
}
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result;
}
export function changedFiles(sha, base = 'origin/main') {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Expected exact 40-character tested SHA');
  const git = args => execute('git', args, { encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
  if (git(['rev-parse', 'HEAD']) !== sha) throw new Error('Tested SHA differs from checkout HEAD');
  const ancestor = git(['merge-base', sha, base]);
  const files = git(['diff', '--name-only', '-z', ancestor, sha]).split('\0').filter(Boolean);
  return { base: ancestor, files };
}
export function environmentTests(root = repoRoot) {
  const files = ['approve.test.sh', 'omk.test.sh', 'pipeline-distribution.test.sh', 'pipeline-errexit.test.sh', 'pipeline.test.sh'];
  for (const file of files) if (!existsSync(resolve(root, 'scripts/env', file))) throw new Error(`Missing required environment test: ${file}`);
  return files.map(file => `scripts/env/${file}`);
}
// Host setup fixtures: the first two run everywhere; the rest need macOS (lockf, plutil, launchd fakes) and run on
// darwin here — elsewhere the required CI mac-host-repair job runs them on the same commit with bash 3.2 and 5.
export function hostSetupTests(root = repoRoot) {
  const portable = ['scripts/ci/docker-config-reconcile.test.mjs', 'scripts/setup/mac-toolchain.test.sh'];
  const macOnly = ['scripts/setup/colima-boot-guard.test.sh', 'scripts/setup/mac-host-repair.test.sh', 'scripts/setup/mac-pm2-boot.test.sh'];
  for (const file of [...portable, ...macOnly]) if (!existsSync(resolve(root, file))) throw new Error(`Missing required host setup test: ${file}`);
  return { portable, macOnly };
}
export function runFeatures(files, options = {}) {
  const root = options.cwd || repoRoot;
  const run = (command, args, config = {}) => execute(command, args, { cwd: root, env: options.env || process.env, ...(options.stdio ? { stdio: options.stdio } : {}), ...config });
  const selection = selectFeatures(files);
  const tests = new Set();
  const related = new Map();
  for (const file of selection.api) {
    // Deleted source cannot be resolved by Jest: fail explicitly until a regression test is mapped.
    if (!existsSync(resolve(root, file))) throw new Error(`Deleted source requires explicit regression mapping: ${file}`);
    const result = run(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'apps/api/jest.config.js', '--findRelatedTests', resolve(root, file), '--listTests', '--json', '--runInBand'], { encoding: 'utf8', stdio: 'pipe' });
    const paths = requireRelated(file, JSON.parse(result.stdout));
    related.set(file, paths);
    for (const path of paths) tests.add(path);
  }
  if (tests.size) {
    const temporary = mkdtempSync(resolve(tmpdir(), 'omk-feature-jest-'));
    try {
      const report = resolve(temporary, 'report.json');
      run(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'apps/api/jest.config.js', '--runInBand', '--json', '--outputFile', report, '--runTestsByPath', ...tests]);
      assertExecuted(related, JSON.parse(readFileSync(report)));
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  if (selection.web) run('npm', ['run', 'test:web']);
  if (selection.pipeline) {
    const files = readdirSync(resolve(root, 'tests/pipeline')).filter(f => f.endsWith('.test.mjs'));
    if (!files.length) throw new Error('Empty required pipeline test suite');
    const additional = ['scripts/ci', 'scripts/pipeline'].flatMap(dir => readdirSync(resolve(root, dir)).filter(f => f.endsWith('.test.mjs')).map(f => `${dir}/${f}`));
    run(process.execPath, ['--test', ...files.map(f => `tests/pipeline/${f}`), ...additional]);
    for (const script of environmentTests(root)) run('bash', [script]);
  }
  if (selection.infra) run('npm', ['run', 'test:infra']);
  if (selection.bridge) run('npm', ['test', '--workspace=@openmake/local-bridge-core']);
  let hostSetup;
  if (selection.hostSetup) {
    const { portable, macOnly } = hostSetupTests(root);
    const platform = options.platform || process.platform;
    const executed = platform === 'darwin' ? [...portable, ...macOnly] : portable;
    for (const file of executed) run(...(file.endsWith('.mjs') ? [process.execPath, ['--test', file]] : ['bash', [file]]));
    hostSetup = { platform, executed, delegatedToMacJob: platform === 'darwin' ? [] : macOnly };
  }
  return { selection, relatedTests: [...tests].map(path => relative(root, path)), ...(hostSetup ? { hostSetup } : {}) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let sha, change;
    if (process.argv[2] === '--files') {
      const input = JSON.parse(readFileSync(process.argv[3]));
      sha = input.sha;
      const head = execute('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' }).stdout.trim();
      if (!/^[0-9a-f]{40}$/.test(sha) || head !== sha || !Array.isArray(input.files) || input.files.some(file => typeof file !== 'string')) throw new Error('Invalid tested SHA or feature input');
      change = { files: input.files };
    } else { sha = process.argv[2]; change = changedFiles(sha); }
    const report = { sha, ...change, ...runFeatures(change.files) };
    if (process.argv[4] === '--report') writeFileSync(process.argv[5], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
