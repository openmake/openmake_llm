/**
 * 내장 add-on 의 데이터 모듈 로더 (2026-10-18) — 계약은 `runtime-ports/data-data.ts`.
 *
 * 다른 진입점(라우트·채팅 통합·런타임)과 달리 **env·DB 로 꺼진 add-on 도 불러온다** — 내보내기·삭제·메모리 격리·보존 정리는
 * 기능의 켜짐과 무관한 의무다(꺼진 add-on 의 코드는 올리지 않는다는 원칙의 유일한 예외, 설계 문서 §8.4·§14).
 * 처음 쓸 때 한 번 불러와 둔다. 불러오지 못한 모듈은 null 과 사유로 남겨 부르는 쪽이 fail-closed 로 처리하게 한다.
 *
 * @module addon-host/addon-data
 */
import type { AddonDataModule, LoadedAddonDataModule } from '../runtime-ports/addon-data';
import { createLogger } from '../utils/logger';
import { listBuiltinAddonDefs } from './builtin-registry';
import { loadAddonEntry } from './entry-loader';

const logger = createLogger('AddonDataModule');

let loaded: readonly LoadedAddonDataModule[] | null = null;

/** 매니페스트에 `entry.data` 를 선언한 내장 add-on 전부(켜짐 무관) */
export function getAddonDataModules(): readonly LoadedAddonDataModule[] {
    loaded ??= listBuiltinAddonDefs()
        .filter((a) => a.manifest.entry?.data)
        .map((a): LoadedAddonDataModule => {
            try {
                return { addonId: a.id, data: loadAddonEntry<AddonDataModule>(a, a.manifest.entry!.data!), error: null };
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                logger.error(`add-on '${a.id}' 데이터 모듈을 불러오지 못했습니다 — 사용자 삭제는 거절, 내보내기는 실패 카테고리로 알린다: ${error}`);
                return { addonId: a.id, data: null, error };
            }
        });
    return loaded;
}

/** 테스트용 — 다음 호출에서 다시 불러온다 */
export function resetAddonDataModulesForTest(): void {
    loaded = null;
}
