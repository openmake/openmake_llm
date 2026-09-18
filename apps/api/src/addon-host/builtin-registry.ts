/**
 * 내장 Add-on 레지스트리 — 기본 제공 add-on 을 **매니페스트로 발견**한다 (Add-on 전환 P1 2026-09-18, 발견 방식 09-19).
 *
 * 목록·종류·순서·코드 진입점은 코드에 적지 않는다 — `addons/builtin/<id>/openmake-addon.json` 이 SoT 다.
 * 새 add-on 은 디렉토리와 매니페스트를 더하면 되고 이 모듈을 고치지 않는다.
 * 켜짐 여부는 배포마다 다른 값이라 env(`ADDON_BUILTIN_DISABLED`, 쉼표 구분 id)로 받는다. 에이전트 정의는
 * 모듈 로드 시점에 읽히므로 DB overlay(system_settings)보다 앞선다 — 변경은 재시작으로 반영.
 * 이 모듈은 매니페스트 스키마(zod) 외의 앱 모듈을 import 하지 않는다(콘텐츠 로더가 순환 없이 부를 수 있어야 한다).
 *
 * 팩 콘텐츠 원본은 `apps/api/addons/builtin/<id>/` 이고, 빌드(`copy-addons`)가 `dist/addon-packs/` 로 스냅샷을 뜬다
 * (`dist/addons/` 는 add-on **코드**(`src/addons/`)의 컴파일 산출물 자리라 이름을 달리했다 — 같은 이름이면 스냅샷의
 * `rm -rf` 가 컴파일된 add-on 코드를 지운다).
 * 빌드본은 **스냅샷만** 읽는다 — 운영 프로세스가 작업 트리를 직접 읽으면 브랜치 전환·편집이 재시작 시점에
 * 운영 콘텐츠를 바꾼다(2026-09-19, 작업 브랜치가 지운 파일을 운영 빌드가 찾지 못할 뻔했다). 스냅샷이 없으면
 * 발견이 throw 해 부팅에서 드러난다(조용한 폴백 없음). 콘텐츠 경로는 `builtinAddonDir` 로만 풀 것.
 *
 * @module addon-host/builtin-registry
 */
import * as fs from 'fs';
import * as path from 'path';
import { ADDON_MANIFEST_FILENAME, addonManifestSchema, type AddonManifest } from './manifest';

/** `order` 를 적지 않은 add-on 의 순서 — 명시한 것 뒤, 서로는 id 순 */
const DEFAULT_ADDON_ORDER = 100000;

export interface BuiltinAddon {
    id: string;
    dir: string;
    manifest: AddonManifest;
}

/** 이 모듈이 빌드 산출물(`<outDir>/addon-host`)에서 실행 중인가 — src(ts-node·jest)면 false. */
const RUNNING_FROM_BUILD = path.basename(path.resolve(__dirname, '..')) !== 'src';

/** 내장 add-on 콘텐츠 루트 — 빌드본은 `<outDir>/addon-packs/builtin` 스냅샷, src 실행은 `apps/api/addons/builtin` 원본. */
function builtinAddonsRoot(): string {
    return RUNNING_FROM_BUILD
        ? path.resolve(__dirname, '..', 'addon-packs', 'builtin')
        : path.resolve(__dirname, '..', '..', 'addons', 'builtin');
}

/** 내장 add-on 코드 루트 — `src/addons`(빌드본 `<outDir>/addons`). 매니페스트 `entry` 가 여기 기준으로 풀린다. */
export function builtinAddonCodeDir(id: string): string {
    return path.resolve(__dirname, '..', 'addons', id);
}

let discovered: { addons: BuiltinAddon[]; invalid: string[] } | null = null;

function discover(): { addons: BuiltinAddon[]; invalid: string[] } {
    if (discovered) return discovered;
    const root = builtinAddonsRoot();
    const addons: BuiltinAddon[] = [];
    const invalid: string[] = [];
    // 루트가 없으면 readdirSync 가 throw — 스냅샷 누락을 부팅에서 드러낸다
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const manifestPath = path.join(dir, ADDON_MANIFEST_FILENAME);
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
            if (manifest.id !== entry.name) throw new Error(`매니페스트 id '${manifest.id}' 가 디렉토리 이름과 다르다`);
            addons.push({ id: manifest.id, dir, manifest });
        } catch (err) {
            invalid.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    addons.sort((a, b) => (a.manifest.order ?? DEFAULT_ADDON_ORDER) - (b.manifest.order ?? DEFAULT_ADDON_ORDER) || a.id.localeCompare(b.id));
    discovered = { addons, invalid };
    return discovered;
}

/** 발견된 내장 add-on 전체(꺼진 것 포함) — 매니페스트 `order` 순 */
export function listBuiltinAddonDefs(): readonly BuiltinAddon[] {
    return discover().addons;
}

/** 매니페스트를 읽지 못해 **로드되지 않은** 디렉토리와 사유 — 호스트가 부팅 로그로 알린다 */
export function invalidBuiltinAddons(): readonly string[] {
    return discover().invalid;
}

export function enabledBuiltinAddons(): BuiltinAddon[] {
    return discover().addons.filter(a => isBuiltinAddonEnabled(a.id));
}

export function builtinAddonIds(): string[] {
    return discover().addons.map(a => a.id);
}

export function builtinAddonDir(id: string): string {
    const found = discover().addons.find(a => a.id === id);
    if (!found) throw new Error(`알 수 없는 내장 add-on: ${id}`);
    return found.dir;
}

function disabledIds(): Set<string> {
    return new Set((process.env.ADDON_BUILTIN_DISABLED ?? '').split(',').map(s => s.trim()).filter(Boolean));
}

export function isBuiltinAddonEnabled(id: string): boolean {
    return !disabledIds().has(id);
}

/** 설정에 적혔지만 발견되지 않은 id — 오타로 add-on 이 조용히 켜진 채 남는 것을 부팅 로그로 알린다. */
export function unknownDisabledIds(): string[] {
    const known = builtinAddonIds();
    return [...disabledIds()].filter(id => !known.includes(id));
}

/** 테스트 전용 — 발견 캐시 초기화 */
export function resetBuiltinAddonDiscoveryForTest(): void {
    discovered = null;
}
