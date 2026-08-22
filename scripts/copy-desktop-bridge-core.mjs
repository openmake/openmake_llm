/**
 * 데스크톱용 브리지 코어 복사 — packages/local-bridge-core/dist → apps/desktop/local-bridge-core/.
 *
 * 데스크톱(apps/desktop)은 npm workspace 밖(자체 lock, electron-builder)이라 workspace 패키지를
 * 의존으로 걸 수 없다. 빌드 산출물(CJS)을 디렉토리째 복사해 `require('./local-bridge-core')` 로
 * 쓰는 방식을 택한다 (copy-agent-data 관용구). 복사본은 gitignore — 소스 오브 트루스는 패키지.
 *
 * 실행: node scripts/copy-desktop-bridge-core.mjs  (데스크톱 npm prestart/predist 가 호출)
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(repo, 'packages/local-bridge-core/dist');
const dst = join(repo, 'apps/desktop/local-bridge-core');

if (!existsSync(join(src, 'index.js'))) {
    console.error('[copy-desktop-bridge-core] 패키지 미빌드 — 레포 루트에서 `npm run build:packages` 먼저 실행하세요.');
    process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
// 복사본임을 명시 — 여기를 고치면 다음 복사에서 사라진다.
writeFileSync(join(dst, 'README-GENERATED.md'),
    '이 디렉토리는 packages/local-bridge-core/dist 의 **복사본**입니다(생성물, gitignore).\n' +
    '수정은 패키지 소스에서 하고 `node scripts/copy-desktop-bridge-core.mjs` 로 재복사하세요.\n');
console.log(`[copy-desktop-bridge-core] 복사 완료: ${dst}`);
