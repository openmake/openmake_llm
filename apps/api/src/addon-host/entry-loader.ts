/**
 * 내장 add-on 코드 진입점 로더 — 매니페스트 `entry` 의 `<모듈>#<export>` 참조를 푼다 (2026-09-19).
 *
 * 로더 표를 코드에 두지 않는다 — 어떤 add-on 이 어떤 확장점에 기여하는지는 그 add-on 의 매니페스트가 선언한다.
 * 대상은 레포에 코드가 있는 내장 add-on 뿐이다(`builtinAddonCodeDir`). 참조 형식은 매니페스트 스키마가
 * 소문자 세그먼트로 제한하고, 여기서도 풀린 경로가 add-on 코드 디렉토리 안인지 다시 확인한다.
 * 켜진 add-on 만 require 한다(지연 로드) — 꺼진 add-on 의 코드는 프로세스에 올라오지 않는다.
 *
 * @module addon-host/entry-loader
 */
import * as path from 'path';
import { builtinAddonCodeDir, type BuiltinAddon } from './builtin-registry';

export function loadAddonEntry<T>(addon: BuiltinAddon, ref: string): T {
    const [modulePath, exportName = 'default'] = ref.split('#');
    const codeDir = builtinAddonCodeDir(addon.id);
    const resolved = path.resolve(codeDir, modulePath);
    if (!resolved.startsWith(codeDir + path.sep)) throw new Error(`add-on '${addon.id}' 진입점이 코드 디렉토리 밖: ${ref}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(resolved) as Record<string, unknown>;
    const value = mod[exportName];
    if (value === undefined || value === null) throw new Error(`add-on '${addon.id}' 진입점에 export '${exportName}' 없음: ${ref}`);
    return value as T;
}
