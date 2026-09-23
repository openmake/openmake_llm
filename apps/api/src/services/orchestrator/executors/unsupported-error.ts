/**
 * @module services/orchestrator/executors/unsupported-error
 * @description 검증된 provider 어댑터가 없는 capability 의 명시 실패 — `executors/index.ts` 와 legacy bridge 가 공유한다
 * (bridge → index 순환을 피하려고 분리, P02).
 */
import type { Capability } from '../../../config/capabilities';

export class UnsupportedCapabilityError extends Error {
    constructor(public readonly capability: Capability) {
        super(`${capability}: 검증된 provider 어댑터가 아직 없습니다 (unsupported)`);
    }
}
