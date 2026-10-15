/**
 * Capability 계약 — Base 가 기능 구현(Add-on)에 요구하는 전부 (Base·Add-on 통합 P02, 2026-09-23).
 *
 * 원칙(계획서 6.1):
 *  - capability ID 는 종전 그대로(`image.generate` 등) — 이름을 바꾸지 않는다.
 *  - 등록 여부 · Add-on 활성 · 사용자 권한 · 모델 배정 · Provider 지원은 **각각 별도 상태**다.
 *  - 순수 metadata(`CapabilityDefinition`)와 실행 handler 를 분리한다 — 웹·API 에는 metadata 만 나간다.
 *  - handler 의 실행 시그니처는 P02 에서 기존 실행기(`CapabilityExecutor`)와 같다. P04 의 Restricted ModelInvoker 가
 *    들어오면 `ctx` 가 승인 handle 기반으로 좁혀진다(계약 버전은 그대로 1 — 필드 추가만).
 *
 * 2026-10-16(3차 C2): 순수 metadata·소유자·실행 문맥 DTO 의 원천은 계약 패키지 `@openmake/plugin-contracts` 다 — 이 파일은
 * 그것을 재수출하고, Base 포트(승인 handle·제한 호출·Artifact·Job)를 붙인 `CapabilityContext`·`CapabilityHandler` 만 정의한다.
 * 오케스트레이터 모듈(`services/orchestrator/*`)에 기대지 않는다 — 두 쪽이 같은 모양인지는
 * `__tests__/plugin-contracts-compat.test.ts` 가 tsc 로 고정한다.
 *
 * @module capability-contract/types
 */
import type {
    CAPABILITY_CONTRACT_VERSION as CONTRACT_CAPABILITY_VERSION,
    CapabilityDefinition, CapabilityExecContextDTO, CapabilityExecutorOutputDTO, CapabilityOwner, CapabilityTaskDTO,
    ModelDescriptor, SupportVerdict,
} from '@openmake/plugin-contracts';
import type { Capability } from '../config/capabilities';
import type { ApprovedInvocationHandle } from './admission';
import type { RestrictedModelInvoker } from '../runtime-ports/model-invoker';
import type { ScopedArtifactStore } from '../runtime-ports/artifact-store';
import type { JobDriver, ScopedJobRuntime } from '../runtime-ports/job-runtime';
import type { OperationSpec } from '../runtime-ports/model-invoker';

export type {
    AddonId, CapabilityDefinition, CapabilityId, CapabilityOwner, DirectTransport, JsonSchema, ModelDescriptor, SupportVerdict,
} from '@openmake/plugin-contracts';

/** 값은 Base 가 들고(API 는 계약 패키지를 런타임에 require 하지 않는다 — type-only 규칙), 타입은 계약 상수에 고정한다 */
export const CAPABILITY_CONTRACT_VERSION: typeof CONTRACT_CAPABILITY_VERSION = 1;

/**
 * Add-on handler 가 받는 실행 문맥(P04) — 계약 실행 문맥(`CapabilityExecContextDTO`, Base capability 합집합으로 좁힘)에
 * 승인 handle · 제한 호출 포트 · scoped Artifact 포트를 더한 것이다. 종전 `ExecContext` 에서 **`targets`(헤더·키 포함)·`handles` 를
 * 뺀** 모양과 같다: raw 자격증명은 `model` 포트 안에만 있다(T08).
 * Base 소유(legacy bridge) 실행기는 전환 기간 동안 `targets` 를 덧붙여 받는다(executor.ts).
 */
export interface CapabilityContext extends CapabilityExecContextDTO<Capability> {
    invocation: ApprovedInvocationHandle;
    model: RestrictedModelInvoker;
    artifacts: ScopedArtifactStore;
    /** 장시간 작업의 소유·상태·중복 제출 방지(P07) — 저장소는 Base */
    jobs: ScopedJobRuntime;
    traceId: string;
}

export interface CapabilityHandler {
    /** 실행 — ctx 는 승인 handle 기반 문맥. 임의 모델·Provider·URL 을 고를 수 없다(포트가 거절) */
    execute(task: CapabilityTaskDTO<Capability>, ctx: CapabilityContext): Promise<CapabilityExecutorOutputDTO>;
    /** 계획 인자 정규화 hook(원문 우선 보정 등). 원문 의미를 조용히 바꾸지 않는다 — 진단은 로그로 */
    normalizePlanInput?(task: CapabilityTaskDTO<Capability>, userMessage: string): CapabilityTaskDTO<Capability>;
    /** 이 driver 가 배정된 모델을 지원하는가 — 배정 저장·실행 전 검사 */
    describeProviderSupport?(model: ModelDescriptor): SupportVerdict;
    /**
     * job capability 의 "기존 결과 조회" 발화 주제어(P08) — Base 의 공통 Job 참조 보정(`coerceJobFollowup`)이 이 주제어와
     * 언어 공통의 결과 의도 패턴이 함께 맞을 때만 Planner 계획을 재조회로 보정한다(새 생성·설명 요청은 보정하지 않는다).
     */
    jobFollowupTopic?: RegExp;
    /** execution.mode='job' capability 의 provider 작업 driver — 백그라운드 poller(P07b)가 재시작 뒤에도 이것으로 이어 간다 */
    jobDriver?: JobDriver;
    /** driver 가 쓰는 추가 provider 연산(경로 템플릿) — 등록 시 검증, 포트가 origin·자격증명을 붙인다 */
    operations?: Readonly<Record<string, OperationSpec>>;
}

export interface CapabilityRegistration {
    definition: CapabilityDefinition;
    owner: CapabilityOwner;
    handler: CapabilityHandler;
}

/** Base 예약 소유자 — legacy bridge(텍스트·비전·오디오·웹·분석 계열)가 이 이름으로 등록한다 */
export const BASE_CAPABILITY_OWNER: CapabilityOwner = { addonId: 'base', addonVersion: '1', source: 'builtin' };
