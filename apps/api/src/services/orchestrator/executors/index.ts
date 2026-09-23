/**
 * @module services/orchestrator/executors
 * @description capability → 실행기 조회 **shim** (P02, 2026-09-23). 정적 import 표는 없어졌다 — 실행기는 Capability Registry
 * (`runtime-ports/capability-runtime`)에 등록된 handler 이고, 텍스트·비전·오디오·웹·분석 계열은 legacy bridge 가 Base 소유로
 * 등록한다. 시그니처는 종전과 같다(`executor.ts` 무변경).
 *  - Registry 에 없음 → `CapabilityNotRegisteredError`(소유 add-on 꺼짐·부팅 실패 = disabled)
 *  - 등록됐지만 어댑터 없음 → `UnsupportedCapabilityError`(handler 가 던진다)
 */
import type { Capability } from '../../../config/capabilities';
import type { CapabilityExecutor } from '../types';
import { getCapabilityRegistry } from '../../../runtime-ports/capability-runtime';
import { CapabilityNotRegisteredError } from '../../../capability-contract/errors';
import { ensureLegacyCapabilityBridge } from '../../../addon-host/legacy-capability-bridge';

export { UnsupportedCapabilityError } from './unsupported-error';

export function executorFor(capability: Capability): CapabilityExecutor {
    ensureLegacyCapabilityBridge();
    const reg = getCapabilityRegistry().get(capability);
    if (!reg) return async () => { throw new CapabilityNotRegisteredError(capability); };
    return (task, ctx) => reg.handler.execute(task, ctx);
}
