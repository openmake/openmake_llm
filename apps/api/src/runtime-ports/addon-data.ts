/**
 * Add-on 데이터 모듈 계약 — 기능이 꺼져 있어도 지켜야 하는 사용자 데이터 처리(의무) (2026-10-18, MCP·스킬 저장 계층 이전).
 *
 * GDPR 이동권(내보내기)·삭제권(사용자 삭제)·전역 메모리 격리·보존 정리는 add-on 의 켜짐과 무관하다 — 기능을 env·DB 로
 * 꺼도 그 add-on 이 소유한 테이블(`config/addon-boundary.ts` `ADDON_OWNED_CORE_TABLES`·add-on 마이그레이션 테이블)의
 * 데이터는 남아 있기 때문이다. 그래서 호스트는 이 모듈만은 **꺼진 add-on 도** 불러온다(`addon-host/addon-data.ts`,
 * 매니페스트 `entry.data`). 모듈은 런타임·외부 연결 없이 SQL 만 쓰도록 가볍게 만든다.
 *
 * Base 는 add-on 테이블 이름을 모르고 아래 훅을 차례로 부를 뿐이다. 실패 처리는 부르는 쪽이 정한다 —
 * 사용자 삭제는 되돌리고(fail-closed), 내보내기는 그 add-on 을 실패 카테고리로 알리고, 격리 판정은 격리로 본다.
 *
 * @module runtime-ports/addon-data
 */
import type { PoolClient } from 'pg';

export interface AddonDataModule {
    /**
     * GDPR 20조 이동권 — 이 add-on 이 가진 사용자 데이터. 키는 내보내기 응답의 최상위 키(예: `skillManifests`)이고
     * 같은 키로 `_meta.counts` 에 개수가 실린다. 던지면 그 add-on 은 `_meta.failedCategories` 에 실린다.
     */
    exportUserData?(userId: string): Promise<Record<string, unknown[]>>;
    /** 사용자 삭제 트랜잭션 안의 정리 — `tx` 로만 쓴다. 던지면 사용자 삭제 전체가 되돌려진다 */
    onUserDelete?(tx: Pick<PoolClient, 'query'>, userId: string): Promise<void>;
    /** 이 대화의 발화를 전역 메모리로 보내지 않아야 하는가(보호 훅) — 던지면 격리로 본다 */
    isMemoryIsolatedSession?(userId: string, sessionId: string): Promise<boolean>;
    /** 주기 보존 정리(`data/db-retention.ts` 가 부른다) — 지운·바꾼 행 수를 돌려준다. 실패는 그 작업만 건너뛴다 */
    retention?: ReadonlyArray<{ name: string; run(): Promise<number> }>;
}

/** 호스트가 불러온 결과 — 모듈을 불러오지 못했으면 `data` 가 null 이고 `error` 에 사유가 있다 */
export interface LoadedAddonDataModule {
    addonId: string;
    data: AddonDataModule | null;
    error: string | null;
}
