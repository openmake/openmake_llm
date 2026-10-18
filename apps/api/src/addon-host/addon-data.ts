/**
 * 내장 add-on 의 데이터 모듈 로더 (2026-10-18) — 계약은 `runtime-ports/addon-data.ts`·`runtime-ports/component-stores.ts`.
 *
 * 다른 진입점(라우트·채팅 통합·런타임)과 달리 **env·DB 로 꺼진 add-on 도 불러온다** — 내보내기·삭제·메모리 격리·보존 정리는
 * 기능의 켜짐과 무관한 의무다(꺼진 add-on 의 코드는 올리지 않는다는 원칙의 유일한 예외, 설계 문서 §8.4·§14).
 * 처음 쓸 때 한 번 불러와 둔다. 불러오지 못한 모듈은 null 과 사유로 남겨 부르는 쪽이 fail-closed 로 처리하게 한다.
 *
 * @module addon-host/addon-data
 */
import type { AddonDataModule, LoadedAddonDataModule } from '../runtime-ports/addon-data';
import { ComponentStoreUnavailableError, type AddonComponentStores, type StoreDb } from '../runtime-ports/component-stores';
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

/**
 * 구성요소 종류의 저장 연산을 DB 연결에 묶어 돌려준다 — 그 종류를 선언한 데이터 모듈이 없으면(빌드에 없음·불러오기 실패)
 * `ComponentStoreUnavailableError` 를 던진다(조용히 건너뛰지 않는다 — 확장 설치·제거가 구성요소를 빠뜨리면 고아 행이 남는다).
 */
export function getComponentStore<K extends keyof AddonComponentStores>(kind: K, db: StoreDb): ReturnType<NonNullable<AddonComponentStores[K]>> {
    const failed: string[] = [];
    for (const { addonId, data, error } of getAddonDataModules()) {
        if (error) { failed.push(`${addonId}: ${error}`); continue; }
        const factory = data?.stores?.[kind];
        if (factory) return (factory as (d: StoreDb) => ReturnType<NonNullable<AddonComponentStores[K]>>)(db);
    }
    throw new ComponentStoreUnavailableError(kind, failed.length ? `불러오지 못한 데이터 모듈: ${failed.join('; ')}` : '선언한 add-on 이 빌드에 없음');
}
