/**
 * Add-on 활성 축의 어휘 — 설치 표 상태·관리자 의도·부팅 실패 분류·프로세스 런타임 상태·실효 가용성.
 *
 * 상태 저장과 런타임 존재는 다른 축이다(Base `addon-host/activation.ts`): DB 가 enabled 라도 이 프로세스가 등록에
 * 실패했으면 failed, 재시작 전이면 not_ready 다. 관리자 의도(desiredState)는 부팅 실패가 바꾸지 않는다.
 *
 * @module plugin-contracts/availability
 */

/** 설치 표의 호환 상태 — 부팅 결과(failed)가 섞인다 */
export const ADDON_STATES = ['installed', 'enabled', 'disabled', 'failed'] as const;
export type AddonState = typeof ADDON_STATES[number];

/** 관리자의 사용 의도 — 부팅 실패가 이 값을 바꾸지 않는다 */
export const ADDON_DESIRED_STATES = ['enabled', 'disabled'] as const;
export type AddonDesiredState = typeof ADDON_DESIRED_STATES[number];

/** 부팅 실패 분류 — 관리자 화면·복구 판단이 문자열이 아니라 코드로 읽는다 */
export const ADDON_FAILURE_CODES = ['migration_failed', 'runtime_failed', 'version_mismatch', 'registration_failed', 'needs_retry'] as const;
export type AddonFailureCode = typeof ADDON_FAILURE_CODES[number];

/** 이 프로세스가 add-on 코드를 어디까지 세웠나 — stopping·stopped 는 런타임 handle 을 정지한 상태(코드는 프로세스에 남는다) */
export type AddonRuntimeStatus = 'not_loaded' | 'registering' | 'ready' | 'stopping' | 'stopped' | 'failed';

/** 가용성 중 add-on 축이 결정하는 것 — capability 축(unassigned·unsupported·forbidden)은 Registry 가 더한다 */
export type AddonAvailability = 'available' | 'disabled' | 'not_ready' | 'failed' | 'incompatible' | 'state_unknown';

/** 부팅 절차가 설치 표에서 읽는 것 — 관리자 의도와 호환 상태뿐(표의 다른 열은 계약 밖) */
export interface AddonInstallationIntent {
    addonId: string;
    desiredState: AddonDesiredState;
    state: AddonState;
}
