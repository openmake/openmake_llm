import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './dev-checks-process.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('./feature-checks.manifest.json', import.meta.url)));
export function selectE2E(files, config = manifest.e2e, checkout = root) {
  const selected = new Set(files.filter(file => /^tests\/e2e\/.*\.spec\.ts$/.test(file)));
  for (const [prefix, specs] of Object.entries(config?.sourcePrefixes || {})) {
    if (!prefix || prefix.includes('..') || !Array.isArray(specs) || !specs.length) throw new Error('Invalid E2E source-prefix mapping');
    if (files.some(file => file.startsWith(prefix))) for (const spec of specs) selected.add(spec);
  }
  return [...selected].sort().map(file => {
    if (!/^tests\/e2e\/[a-zA-Z0-9_/-]+\.spec\.ts$/.test(file)) throw new Error(`Unsafe selected E2E path: ${file}`);
    const target = config?.specs?.[file]?.target;
    if (!['api', 'web'].includes(target)) throw new Error(`Declare api|web target for ${file} in feature-checks.manifest.json`);
    if (!existsSync(resolve(checkout, file))) throw new Error(`Missing selected E2E spec: ${file}`);
    return { file, target };
  });
}
export function assertE2EExecuted(file, report) {
  let passed = 0, failed = (report.errors || []).length > 0;
  const inspect = suites => {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        if (![file, file.replace(/^tests\/e2e\//, '')].includes(spec.file)) continue;
        for (const test of spec.tests || []) for (const result of test.results || []) {
          if (test.projectName !== 'chromium') continue;
          if (result.status === 'passed') passed++;
          else if (result.status !== 'skipped') failed = true;
        }
      }
      inspect(suite.suites);
    }
  };
  inspect(report.suites);
  if (failed) throw new Error(`Selected E2E failed: ${file}`);
  if (!passed) throw new Error(`No actual passed tests for selected E2E ${file} (missing or all skipped)`);
  return passed;
}
export async function runSelectedE2E(selected, { checkout, env, apiURL, webURL, sha, buildHash, signal, reportDir }) {
  if (!selected.length) return [];
  const cli = resolve(checkout, 'node_modules/playwright/cli.js');
  const run = (args, environment = env) => runCommand(process.execPath, [cli, ...args], { cwd: checkout, env: environment, signal });
  if (selected.some(spec => spec.target === 'web')) await run(['install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium']);
  const evidence = [];
  for (const [index, spec] of selected.entries()) {
    const reportPath = resolve(reportDir, `selected-e2e-${index}.json`);
    const exactFile = spec.file.replaceAll('.', '\\.') + '$';
    await run(['test', exactFile, '--project=chromium', '--reporter=json'], {
      ...env, E2E_BASE_URL: spec.target === 'api' ? apiURL : webURL,
      E2E_WS_ORIGIN: webURL, E2E_EXPECTED_SHA: sha, E2E_EXPECTED_BUILD_HASH: buildHash,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
    });
    evidence.push({ ...spec, passed: assertE2EExecuted(spec.file, JSON.parse(await readFile(reportPath))) });
  }
  return evidence;
}
