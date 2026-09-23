/**
 * Capability 계약 오류 — 등록·소유·실행 승인 단계의 명시 실패 (P02, 2026-09-23).
 * 기존 코드(`CapabilityUnavailableError`·`UnsupportedCapabilityError`)는 호환 유지하고 여기서는 Registry 축만 더한다.
 *
 * @module capability-contract/errors
 */
import { AppError } from '../utils/error-handler';

export type CapabilityRegistryErrorCode =
    | 'CAPABILITY_ID_INVALID'
    | 'CAPABILITY_DUPLICATE'
    | 'CAPABILITY_OWNERSHIP_CONFLICT'
    | 'CAPABILITY_PROVIDES_MISMATCH'
    | 'CAPABILITY_NOT_REGISTERED'
    | 'CAPABILITY_REVISION_STALE';

export class CapabilityRegistryError extends AppError {
    constructor(message: string, public readonly registryCode: CapabilityRegistryErrorCode) {
        super(message, 400, true, registryCode);
    }
}

/** 실행 시점에 Registry 에 없는 capability — 소유 add-on 이 꺼졌거나 부팅에 실패한 상태(`unsupported` 와 구분) */
export class CapabilityNotRegisteredError extends CapabilityRegistryError {
    constructor(public readonly capability: string) {
        super(`${capability}: 제공하는 add-on 이 꺼져 있거나 준비되지 않았습니다 (disabled)`, 'CAPABILITY_NOT_REGISTERED');
    }
}
