import { buildSync } from 'esbuild';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'openmake-web-tests-'));
try {
  // tests/web/*.test.ts(x) 전부 — 파일을 하나씩 번들해 node:test 로 돈다
  const dir = resolve(root, 'tests/web');
  const files = readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f)).sort();
  const outputs = files.map((f) => join(temp, f.replace(/\.tsx?$/, '.cjs')));
  files.forEach((f, i) => buildSync({
    entryPoints: [join(dir, f)],
    outfile: outputs[i],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    tsconfig: resolve(root, 'apps/web/tsconfig.json'),
    logLevel: 'warning',
  }));
  const result = spawnSync(process.execPath, ['--test', ...outputs], {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: resolve(root, 'node_modules') },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
