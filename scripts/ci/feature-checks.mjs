// Only fixed runner arguments: changed filenames and manifest data never become shell code.
// Modes: `<sha>` selects and runs changed-feature checks; `--files <json>` does the same for a given file list;
// `--select-only <sha>` only selects and requires related Jest tests to exist (PR CI — nothing runs).
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { selectE2E } from './feature-checks-e2e.mjs';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./feature-checks.manifest.json', import.meta.url)));
// Jest bootstrap files are imported by no test, yet every apps/api suite runs through them: a change selects every suite.
// The dependency extractor decides which tests are "related" at all, so it is bootstrap too.
const JEST_BOOTSTRAP = ['apps/api/jest.config.js', 'apps/api/jest.setup.ts', 'apps/api/jest.setup-after-env.ts', 'apps/api/jest.dependency-extractor.mjs'];
export function selectFeatures(files) {
  const result = { api: [], web: false, pipeline: false, infra: false, bridge: false, discordBot: false, desktopWindows: false, desktopHelper: false, cli: false, hostSetup: false, e2e: selectE2E(files) };
  for (const file of files) {
    if (result.e2e.some(spec => spec.file === file)) continue;
    if (JEST_BOOTSTRAP.includes(file)) { result.api.push(file); continue; }
    if (file.startsWith('apps/api/src/') && /\.[cm]?[jt]sx?$/.test(file)) { result.api.push(file); continue; }
    if (manifest.specs[file]) { result[manifest.specs[file]] = true; continue; }
    // Exact host setup files only — a new setup script stays unmapped until it is listed with fixture coverage.
    if (manifest.hostSetup.includes(file)) { result.hostSetup = true; continue; }
    // Exact non-API files with a fixed consumer suite (e.g. type-only shared contracts) — never a package prefix.
    if (manifest.exactFiles[file]) { result[manifest.exactFiles[file]] = true; continue; }
    if (/(?:^|\/)(?:specs|specifications)\//.test(file)) throw new Error(`Unmapped changed spec: ${file}; add a fixed manifest suite`);
    const match = Object.entries(manifest.prefixes).find(([prefix]) => file.startsWith(prefix));
    if (match) { result[match[1]] = true; continue; }
    if (/\.(?:md|html|svg|png|json)$/.test(file)) continue;
    if (file.startsWith('packages/') && /\.[cm]?[jt]sx?$/.test(file)) { result.api.push(file); continue; }
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
// apps/api/jest.dependency-extractor.mjs counts `import type`/`export type … from` as edges, so a changed type module
// selects the tests of the code using it. Last resort only: a type-only source (CommonJS emit is just the preamble)
// that still has no related test is excused when nothing imports it, or when it is a declaration file (ambient
// declarations apply without import edges). A type module whose importers reach no test still fails.
// A source with syntax errors is never excused (its emit proves nothing).
const DECLARATION_RE = /\.d\.[cm]?ts$/;
const COMMONJS_PREAMBLE = new Set(['"use strict";', 'Object.defineProperty(exports, "__esModule", { value: true });']);
export function isTypeOnlySource(file, text) {
  if (!/\.[cm]?tsx?$/.test(file)) return false;
  if (DECLARATION_RE.test(file)) return true;
  const ts = createRequire(import.meta.url)('typescript');
  const { outputText, diagnostics } = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, removeComments: true } });
  if (diagnostics?.length) return false;
  return outputText.split('\n').every(line => !line.trim() || COMMONJS_PREAMBLE.has(line.trim()));
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
// Host setup fixtures: the portable ones run everywhere; the rest need macOS (lockf, plutil, launchd fakes) and run on
// darwin here — elsewhere the required CI mac-host-repair job runs them on the same commit with bash 3.2 and 5.
export function hostSetupTests(root = repoRoot) {
  const portable = ['scripts/ci/docker-config-reconcile.test.mjs', 'scripts/setup/mac-toolchain.test.sh', 'scripts/setup/colima-selection.test.sh', 'scripts/setup/gen-env.test.mjs'];
  const macOnly = ['scripts/setup/colima-boot-guard.test.sh', 'scripts/setup/mac-host-repair.test.sh', 'scripts/setup/mac-pm2-boot.test.sh'];
  for (const file of [...portable, ...macOnly]) if (!existsSync(resolve(root, file))) throw new Error(`Missing required host setup test: ${file}`);
  return { portable, macOnly };
}
const DELETED_TEST_RE = /\.test\.[cm]?[jt]sx?$|\/__tests__\//;
export function selectRelatedTests(files, options = {}) {
  const root = options.cwd || repoRoot;
  // Deleting a test removes coverage. The manifest must name the path with a reason, so the deletion is an
  // explicit, reviewable decision instead of a silent pass.
  const deletedTests = options.deletedTests ?? manifest.deletedTests ?? {};
  const listRelated = options.listRelated || (file => JSON.parse(execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'apps/api/jest.config.js', '--findRelatedTests', resolve(root, file), '--listTests', '--json', '--runInBand'], { cwd: root, env: options.env || process.env, encoding: 'utf8', stdio: 'pipe' }).stdout));
  // Every module (not only tests) that reaches the file through the same graph — its transitive importers.
  const listImporters = options.listImporters || (file => JSON.parse(execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'apps/api/jest.config.js', '--findRelatedTests', resolve(root, file), '--listTests', '--json', '--runInBand', '--testMatch', '<rootDir>/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'], { cwd: root, env: options.env || process.env, encoding: 'utf8', stdio: 'pipe' }).stdout).filter(path => path !== resolve(root, file)));
  const listAll = options.listAll || (() => JSON.parse(execute(process.execPath, [resolve(root, 'node_modules/jest/bin/jest.js'), '--config', 'apps/api/jest.config.js', '--listTests', '--json', '--runInBand'], { cwd: root, env: options.env || process.env, encoding: 'utf8', stdio: 'pipe' }).stdout));
  const selection = selectFeatures(files);
  const tests = new Set();
  const related = new Map();
  const typeOnly = [];
  const log = options.log || (line => console.error(line));
  for (const file of selection.api) {
    // A deleted test file was itself the regression test — nothing to map, but only when the manifest records why.
    // Deleted source cannot be resolved by Jest: fail explicitly until a regression test is mapped.
    if (!existsSync(resolve(root, file)) && DELETED_TEST_RE.test(file)) {
      const reason = deletedTests[file];
      if (!reason) throw new Error(`Deleted test file requires a reason in scripts/ci/feature-checks.manifest.json "deletedTests" (a rename lists the old path too): ${file}`);
      log(`Deleted test file (${reason}): ${file}`);
      continue;
    }
    if (!existsSync(resolve(root, file))) throw new Error(`Deleted source requires explicit regression mapping: ${file}`);
    const listed = JEST_BOOTSTRAP.includes(file) ? listAll() : listRelated(file);
    if (!listed.length && file.startsWith('apps/api/src/') && isTypeOnlySource(file, readFileSync(resolve(root, file), 'utf8'))) {
      const declaration = DECLARATION_RE.test(file);
      const importers = declaration ? [] : listImporters(file);
      if (importers.length) throw new Error(`No related Jest tests for ${file}; its importers reach no test (${importers.map(path => relative(root, path)).join(', ')}) — add coverage or a fixed mapping`);
      typeOnly.push(file);
      log(`Type-only ${declaration ? 'declaration file' : 'source with no importers'}, related Jest tests not required: ${file}`);
      continue;
    }
    const paths = requireRelated(file, listed);
    related.set(file, paths);
    for (const path of paths) tests.add(path);
  }
  return { selection, related, tests, typeOnly };
}
export function runFeatures(files, options = {}) {
  const root = options.cwd || repoRoot;
  const run = (command, args, config = {}) => execute(command, args, { cwd: root, env: options.env || process.env, ...(options.stdio ? { stdio: options.stdio } : {}), ...config });
  const { selection, related, tests, typeOnly } = selectRelatedTests(files, { cwd: root, env: options.env, log: options.log });
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
    const additional = ['scripts/ci', 'scripts/pipeline', 'scripts/vllm'].flatMap(dir => readdirSync(resolve(root, dir)).filter(f => f.endsWith('.test.mjs')).map(f => `${dir}/${f}`));
    run(process.execPath, ['--test', ...files.map(f => `tests/pipeline/${f}`), ...additional]);
    for (const script of environmentTests(root)) run('bash', [script]);
  }
  if (selection.infra) run('npm', ['run', 'test:infra']);
  if (selection.bridge) run('npm', ['test', '--workspace=@openmake/local-bridge-core']);
  // apps/discord-bot is its own workspace (node --test, see its package.json), not part of the apps/api Jest project.
  if (selection.discordBot) run('npm', ['test', '--workspace=openmake-discord-bot']);
  // apps/desktop-windows is not a root workspace: its own node --test suite (Electron is not loaded by the tests).
  if (selection.desktopWindows) run('npm', ['test'], { cwd: resolve(root, 'apps/desktop-windows') });
  // Same bundle + harness as the desktop-native workflow (Gate 1), on the bundled helper.
  // The harness asserts the macOS sandbox (sandbox-exec), so off macOS only the bundle is built here and the
  // harness is left to the mac job (desktop-native workflow, which also runs on dev/main pushes) — like hostSetup.
  let desktopHelper;
  if (selection.desktopHelper) {
    const platform = options.platform || process.platform;
    run(resolve(root, 'node_modules/.bin/esbuild'), ['apps/desktop-native/helper/src/helper.mjs', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=apps/desktop-native/helper/dist/helper.cjs']);
    if (platform === 'darwin') run(process.execPath, ['apps/desktop-native/helper/harness.cjs']);
    desktopHelper = { platform, bundled: true, harness: platform === 'darwin' ? 'ran' : 'delegatedToMacJob' };
  }
  // The CLI workspace has no Jest project: its tsc build, then the fixtures that drive the built CLI.
  if (selection.cli) {
    run('npm', ['run', 'build', '--workspace=@openmake/cli']);
    run(process.execPath, ['--test', ...readdirSync(resolve(root, 'apps/cli/test')).filter(f => f.endsWith('.test.mjs')).map(f => `apps/cli/test/${f}`)]);
  }
  let hostSetup;
  if (selection.hostSetup) {
    const { portable, macOnly } = hostSetupTests(root);
    const platform = options.platform || process.platform;
    const executed = platform === 'darwin' ? [...portable, ...macOnly] : portable;
    for (const file of executed) run(...(file.endsWith('.mjs') ? [process.execPath, ['--test', file]] : ['bash', [file]]));
    hostSetup = { platform, executed, delegatedToMacJob: platform === 'darwin' ? [] : macOnly };
  }
  return { selection, relatedTests: [...tests].map(path => relative(root, path)), typeOnly, ...(hostSetup ? { hostSetup } : {}), ...(desktopHelper ? { desktopHelper } : {}) };
}
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv[2] === '--select-only') {
  try {
    const sha = process.argv[3];
    const change = changedFiles(sha);
    const { selection, tests, typeOnly } = selectRelatedTests(change.files);
    console.log(JSON.stringify({ sha, ...change, selection, relatedTests: [...tests].map(path => relative(repoRoot, path)), typeOnly }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else if (isMain) {
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
