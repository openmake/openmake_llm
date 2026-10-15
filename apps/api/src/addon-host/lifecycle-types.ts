/**
 * Add-on 런타임 수명주기 계약 — facade (설계 2026-10-16 3차 §2 C1 → §3 C2).
 *
 * 계약 타입의 원천은 `@openmake/plugin-contracts`(lifecycle.ts)다. 이 파일은 Base 의 capability handler 형을 끼운 별칭과
 * 판별 함수만 둔다 — 기존 import 경로(`addon-host/lifecycle-types`, `addon-host` 재수출)는 그대로 쓴다.
 * 판별 함수는 런타임 코드라 계약 패키지(타입·상수만)에 두지 않는다.
 *
 * @module addon-host/lifecycle-types
 */
import type {
    AddonRuntimeEntry as ContractAddonRuntimeEntry, AddonRuntimeHandle, AddonRuntimeHost as ContractAddonRuntimeHost,
} from '@openmake/plugin-contracts';
import type { CapabilityHandler } from '../capability-contract/types';

export type { AddonRuntimeHandle, AddonRuntimeHealth, AddonRuntimeStopOptions } from '@openmake/plugin-contracts';

/** 런타임 진입점이 받는 호스트 문맥 — handler 는 Base 포트(승인 handle·제한 호출·Artifact·Job)를 받는 `CapabilityHandler` */
export type AddonRuntimeHost = ContractAddonRuntimeHost<CapabilityHandler>;

/** 매니페스트 `entry.runtime` 이 가리키는 함수의 모양 */
export type AddonRuntimeEntry = ContractAddonRuntimeEntry<CapabilityHandler>;

/** PURE: 진입점 반환값이 handle 인가 — `void` 를 돌려주는 기존 add-on 과 구분한다 */
export function isAddonRuntimeHandle(value: unknown): value is AddonRuntimeHandle {
    return typeof value === 'object' && value !== null && typeof (value as { stop?: unknown }).stop === 'function';
}
