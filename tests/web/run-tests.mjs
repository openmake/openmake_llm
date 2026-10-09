import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'openmake-web-tests-'));
try {
  const output = join(temp, 'admin-audit.test.cjs');
  buildSync({
    entryPoints: [resolve(root, 'tests/web/admin-audit.test.tsx')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    tsconfig: resolve(root, 'apps/web/tsconfig.json'),
    logLevel: 'warning',
  });
  const result = spawnSync(process.execPath, ['--test', output], {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: resolve(root, 'node_modules') },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
