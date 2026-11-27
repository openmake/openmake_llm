/**
 * @module config/extension-org-deployment
 * @description 조직 공개 확장의 항목별 배포 모드 + 그룹별 덮어쓰기(마켓플레이스 계획 v3.7 §8-1) — 플래그·값 집합·해석 규칙·명명 상수.
 *
 * 값 집합(Cursor 팀 마켓플레이스와 같은 3단):
 *   default_off  갤러리에만 보인다(종전 — 설정이 없으면 이 값)
 *   default_on   멤버에게 자동 설치, 멤버가 지울 수 있고 지우면 다시 설치하지 않는다
 *   required     자동 설치, 일반 멤버는 지울 수 없다(조직 owner/admin·시스템 admin 은 가능)
 *
 * 해석 규칙(Claude 조직 설정 방식의 그룹 덮어쓰기) — **이 파일의 `resolveDeploymentMode` 한 곳**:
 *   ① 멤버가 덮어쓰기를 가진 그룹에 하나라도 속하면 그 덮어쓰기들 중 가장 강한 값(항목 기본값보다 우선 — 약하게 덮을 수도 있다)
 *   ② 아니면 항목 기본값(없으면 default_off)
 *   강도: required > default_on > default_off (`DEPLOYMENT_MODE_STRENGTH`)
 *
 * 플래그 `EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED`(기본 OFF, system_settings 실시간) — 꺼져 있으면 관리 라우트는 404,
 * 갤러리·설치 목록 응답에 배포 필드가 없고, 조정 잡은 아무것도 하지 않으며(DB 조회 0), 제거 거절도 없다(종전 그대로).
 */
import { getConfig } from './env';

export const EXTENSION_ORG_DEPLOYMENT_FLAG = 'EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED';

export const DEPLOYMENT_MODES = ['default_off', 'default_on', 'required'] as const;
export type DeploymentMode = typeof DEPLOYMENT_MODES[number];

/** 기본값 — 행이 없으면 이 값(종전 동작: 갤러리에만) */
export const DEFAULT_DEPLOYMENT_MODE: DeploymentMode = 'default_off';

/** 강도 — 여러 그룹 덮어쓰기가 겹치면 큰 값이 이긴다 */
export const DEPLOYMENT_MODE_STRENGTH: Readonly<Record<DeploymentMode, number>> = {
    default_off: 0,
    default_on: 1,
    required: 2,
};

/** 조정(reconcile)이 멤버에게 설치하는 모드 */
export const AUTO_INSTALL_MODES: ReadonlySet<DeploymentMode> = new Set<DeploymentMode>(['default_on', 'required']);

/** 명명 상수 — 조정 잡·입력 한도 */
export const EXTENSION_ORG_DEPLOYMENT_LIMITS = {
    /** 주기 조정 간격 — 이 간격마다 자동 설치 대상(활성 조직이 그 조직인 멤버)을 맞춘다 */
    TICK_MS: 10 * 60 * 1000,
    /** 한 tick 에 시도하는 설치 수 상한 — 설치 엔진(Git 조회)을 몰아 부르지 않게 */
    MAX_INSTALLS_PER_TICK: 10,
    /** 한 tick 에 살펴보는 (멤버, 조직) 수 상한 — 이미 다 설치된 멤버는 claim 이 0행이라 싸다 */
    CANDIDATES_PER_TICK: 500,
    /** 'installing' 으로 잡힌 채 이 시간이 지나면 죽은 시도로 보고 다시 잡는다(프로세스 중단 대비) */
    INSTALLING_STALE_MS: 30 * 60 * 1000,
    /** 실패한 설치를 다시 시도하기까지 기다리는 시간 */
    FAILED_RETRY_MS: 60 * 60 * 1000,
    /** 실패 재시도 상한 — 넘으면 모드를 다시 저장(관리자 조치)하기 전까지 멈춘다 */
    MAX_ATTEMPTS: 5,
    /** 저장하는 실패 사유 길이 상한 */
    ERROR_MAX_CHARS: 500,
    /** 그룹 이름 길이 상한 */
    GROUP_NAME_MAX_CHARS: 100,
    /** 조직당 그룹 수 상한 */
    MAX_GROUPS_PER_ORG: 100,
} as const;

export function isDeploymentMode(v: unknown): v is DeploymentMode {
    return typeof v === 'string' && (DEPLOYMENT_MODES as readonly string[]).includes(v);
}

/** PURE: 두 값 중 강한 값 */
export function strongerMode(a: DeploymentMode, b: DeploymentMode): DeploymentMode {
    return DEPLOYMENT_MODE_STRENGTH[b] > DEPLOYMENT_MODE_STRENGTH[a] ? b : a;
}

/**
 * PURE: 멤버 한 명에게 적용되는 배포 모드.
 * @param itemDefault  항목 기본값(행 없음 = null → default_off)
 * @param groupOverrides 멤버가 속한 그룹들의 덮어쓰기 값(덮어쓰기가 없는 그룹은 넣지 않는다)
 */
export function resolveDeploymentMode(
    itemDefault: DeploymentMode | null | undefined,
    groupOverrides: readonly DeploymentMode[],
): DeploymentMode {
    if (groupOverrides.length > 0) return groupOverrides.reduce(strongerMode, DEFAULT_DEPLOYMENT_MODE);
    return itemDefault ?? DEFAULT_DEPLOYMENT_MODE;
}

export function extensionOrgDeploymentModesEnabled(): boolean {
    return getConfig().extensionOrgDeploymentModesEnabled;
}
