/**
 * Add-on → Base 내부 import 경계 검사의 공용 함수 (설계 2026-10-16 3차 §3 C2, 결정 D2 ratchet).
 *
 * `apps/api/src/addons/**` 의 소스(테스트·평가 시드 도구 제외)가 Base 내부 계층(BASE_LAYERS)을 직접 import 하는 곳을 모은다.
 * 정적 `import … from`·`export … from`·`import type`, 동적 `import('…')`, `require('…')`, 부수효과 `import '…'` 를 모두 본다.
 * 결과는 "파일 → 대상 모듈(apps/api/src 기준 posix 경로)" 표이고, 같은 파일이 같은 대상을 여러 번 부르면 한 번만 센다.
 * runtime-ports·addon-host·config·utils·계약 패키지(@openmake/plugin-contracts)는 add-on 이 써도 되는 문이라 세지 않는다.
 *
 * @module scripts/lint/addon-boundary-lib
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Base 내부 계층 — add-on 이 직접 부르면 안 되는 디렉터리 */
export const BASE_LAYERS = ['data', 'services', 'routes', 'sockets', 'controllers', 'middlewares', 'auth', 'chat'];

/** 저장소 루트(이 파일은 <루트>/scripts/lint/ 에 있다) */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 허용 목록 파일 */
export const ALLOWLIST_PATH = join(REPO_ROOT, 'scripts', 'lint', 'addon-import-allowlist.json');

/** 검사에서 빼는 디렉터리 이름 — 테스트와 평가(시드) 도구는 운영 경로가 아니다 */
const SKIPPED_DIRS = new Set(['__tests__', 'evaluation']);

const SPECIFIER_PATTERNS = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
];

function listAddonSources(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (!SKIPPED_DIRS.has(name)) out.push(...listAddonSources(full));
        } else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) {
            out.push(full);
        }
    }
    return out;
}

/** PURE: 한 파일 본문에서 Base 계층으로 가는 대상 모듈(src 기준 posix 경로)을 정렬·중복 제거해 돌려준다 */
export function baseTargetsOf(source, fileAbs, srcRoot) {
    const targets = new Set();
    for (const pattern of SPECIFIER_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            if (!specifier.startsWith('.')) continue;
            const rel = relative(srcRoot, resolve(dirname(fileAbs), specifier)).split(sep).join(posix.sep);
            if (rel.startsWith('..')) continue;
            if (BASE_LAYERS.includes(rel.split('/')[0])) targets.add(rel);
        }
    }
    return [...targets].sort();
}

/** 저장소 루트 기준 현재 위반 표 — { "<addons 기준 파일>": ["<대상>", …] } (파일 키 정렬) */
export function collectAddonBaseImports(repoRoot) {
    const srcRoot = join(repoRoot, 'apps', 'api', 'src');
    const addonsRoot = join(srcRoot, 'addons');
    const table = {};
    for (const file of listAddonSources(addonsRoot).sort()) {
        const targets = baseTargetsOf(readFileSync(file, 'utf8'), file, srcRoot);
        if (targets.length > 0) table[relative(addonsRoot, file).split(sep).join(posix.sep)] = targets;
    }
    return table;
}

/** PURE: 허용 목록과 현재 표 비교 — added(목록 밖의 새 쌍, 실패 사유)·removed(코드에서 사라진 쌍, 목록 축소 권고) */
export function diffAllowlist(allowlist, current) {
    const added = [];
    const removed = [];
    for (const [file, targets] of Object.entries(current)) {
        const allowed = new Set(allowlist[file] ?? []);
        for (const target of targets) if (!allowed.has(target)) added.push(`${file} → ${target}`);
    }
    for (const [file, targets] of Object.entries(allowlist)) {
        const now = new Set(current[file] ?? []);
        for (const target of targets) if (!now.has(target)) removed.push(`${file} → ${target}`);
    }
    return { added, removed };
}

/** PURE: 표의 (파일, 대상) 쌍 수 */
export function countPairs(table) {
    return Object.values(table).reduce((n, targets) => n + targets.length, 0);
}
