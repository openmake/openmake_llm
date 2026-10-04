// 메인 프로세스 번들 — 공용 코어를 한 파일로 묶는다(Companion 헬퍼와 같은 방식). electron 은 런타임이 제공한다.
// 사전: 저장소 루트에서 `npm run build:packages` (코어 dist). esbuild 는 루트 node_modules 의 것을 쓴다.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
mkdirSync(join(here, 'dist'), { recursive: true });
execFileSync('npx', ['esbuild', join(here, 'src/main.mjs'), '--bundle', '--platform=node', '--target=node20', '--format=cjs',
    '--external:electron', `--outfile=${join(here, 'dist/main.cjs')}`], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
for (const f of ['settings.html', 'preload.cjs']) cpSync(join(here, 'src', f), join(here, 'dist', f));
