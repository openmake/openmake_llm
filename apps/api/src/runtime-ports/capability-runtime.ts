/**
 * Capability Runtime 포트 — Base 가 기능 구현을 부르는 유일한 문 (Base·Add-on 통합 P02, 2026-09-23).
 *
 * 프로세스 싱글턴 Registry 를 든다. Base(오케스트레이터 executor·preflight·planner·설정 API)는 이 포트로
 * 등록된 capability 를 조회·실행하고, 구현 모듈(`addons/<id>-runtime/`)을 import 하지 않는다.
 * 텍스트·비전·오디오·웹·분석 계열은 `addon-host/legacy-capability-bridge.ts` 가 Base 소유로 등록한다 —
 * 미디어 add-on 을 전부 꺼도 텍스트 기능은 사라지지 않는다.
 *
 * 등록이 없는 capability 는 `CapabilityNotRegisteredError` 로 명시 실패한다(조용한 폴백 없음).
 *
 * @module runtime-ports/capability-runtime
 */
import { CapabilityRegistry } from '../capability-contract/registry';
import type { CapabilityHandler, CapabilityId, CapabilityOwner, CapabilityRegistration } from '../capability-contract/types';
import type { CapabilityDefinition } from '../capability-contract/types';
import { CapabilityNotRegisteredError } from '../capability-contract/errors';

const registry = new CapabilityRegistry();

export function getCapabilityRegistry(): CapabilityRegistry {
    return registry;
}

/**
 * add-on 부팅 진입점이 쓰는 편의 함수 — 한 트랜잭션으로 등록하고 manifest 선언(`expected`)과 대조해 게시한다.
 * 실패하면 아무것도 게시되지 않는다(부분 등록 없음).
 */
export function registerCapabilities(
    owner: CapabilityOwner,
    entries: ReadonlyArray<{ definition: CapabilityDefinition; handler: CapabilityHandler }>,
    expected?: readonly CapabilityId[],
): void {
    const tx = registry.beginRegistration(owner);
    try {
        for (const e of entries) tx.register(e.definition, e.handler);
        tx.commit(expected);
    } catch (err) {
        tx.rollback();
        throw err;
    }
}

/** 실행 직전 조회 — 없으면 명시 실패(소유 add-on 이 꺼졌거나 부팅 실패) */
export function requireCapability(id: CapabilityId): CapabilityRegistration {
    const reg = registry.get(id);
    if (!reg) throw new CapabilityNotRegisteredError(id);
    return reg;
}

/** 테스트 정리용 — 게시 전부 회수 */
export function resetCapabilityRuntimeForTest(): void {
    registry.resetForTest();
}
