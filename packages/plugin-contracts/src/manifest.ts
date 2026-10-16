/**
 * Add-on 매니페스트(`openmake-addon.json`) DTO — 검증기(zod 스키마)는 Base `addon-host/manifest.ts` 가 들고, 이 파일은
 * 검증을 통과한 매니페스트의 **모양**만 정한다. 두 쪽이 같은 모양인지는 apps/api `__tests__/plugin-contracts-compat.test.ts`
 * 가 tsc 로 고정한다(한쪽만 바꾸면 빌드가 깨진다).
 *
 * @module plugin-contracts/manifest
 */

export type AddonScope = 'system' | 'organization' | 'user';
/** content = 스킬·에이전트 정의 팩, integration = 레포에 코드가 있는 통합 기능, runtime = Base 포트에 구현을 꽂는 실행 런타임 */
export type AddonKind = 'content' | 'integration' | 'runtime';
/** 매니페스트 `permissions` 어휘 — 집행 지점이 있는 값만(Base `config/addon-permissions.ts`) */
export type AddonPermissionName = 'network:internet' | 'database:addon';

/** 전용 라우트 — `within: 'v1'` 은 v1 라우터(API 키 인증·스코프·rate limit 뒤) 안에 건다 */
export interface AddonEntryRouteDTO {
    mountPath: string;
    module: string;
    within?: 'v1';
}

/** 워커 프로세스 진입점 — `name` 은 워커 식별자, `module` 은 add-on 루트 기준 모듈 경로 */
export interface AddonEntryWorkerDTO {
    name: string;
    module: string;
}

export interface AddonManifestDTO {
    id: string;
    name: string;
    version: string;
    description?: string;
    requires: {
        /** 호환 앱 버전 범위 — `>=a.b.c <x.y.z` 형태의 비교식 나열 */
        openmake: string;
        /** 필요한 모델 역량 — 부팅 로그·관리 화면이 충족 후보를 안내한다 */
        model?: {
            minContext?: number;
            tools?: boolean;
            vision?: boolean;
        };
        /** 요구하는 capability 계약 버전 */
        capabilityContract?: 1;
    };
    scope: AddonScope;
    kind?: AddonKind;
    /** 로드 순서(작을수록 먼저) */
    order?: number;
    /** 이 add-on 이 소유한 시스템 스킬의 `source_path` LIKE 패턴 */
    skillSourcePath?: string;
    components: {
        skills?: string;
        agents?: string;
        mcp?: string;
        mcpCatalog?: string;
        data?: string;
        routingVocabulary?: string;
        /** add-on 전용 스키마의 마이그레이션 디렉터리 — `migration_versions.version` 은 `addon:<id>:NNN` */
        migrations?: string;
        evals?: string;
    };
    /** 코드 진입점 — 레포에 코드가 있는 내장 add-on 만 가진다(설치형은 거절) */
    entry?: {
        runtime?: string;
        chatIntegration?: string;
        chatMode?: string;
        contributions?: string;
        routes?: AddonEntryRouteDTO[];
        workers?: AddonEntryWorkerDTO[];
    };
    /** Registry 에 게시하는 capability ID 목록 — 런타임 등록 결과와 정확히 일치해야 게시된다 */
    provides?: {
        capabilities: string[];
    };
    permissions?: AddonPermissionName[];
    entitlement?: {
        sku: string;
    };
}
