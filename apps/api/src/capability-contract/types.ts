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
 * @module capability-contract/types
 */
import type { PlanTask } from '../services/orchestrator/plan-schema';
import type { ExecContext, ExecutorOutput } from '../services/orchestrator/types';
import type { ApprovedInvocationHandle } from './admission';
import type { RestrictedModelInvoker } from '../runtime-ports/model-invoker';
import type { ScopedArtifactStore } from '../runtime-ports/artifact-store';
import type { JobDriver, ScopedJobRuntime } from '../runtime-ports/job-runtime';
import type { OperationSpec } from '../runtime-ports/model-invoker';

export type CapabilityId = string;
export type AddonId = string;
export type JsonSchema = Readonly<Record<string, unknown>>;

export const CAPABILITY_CONTRACT_VERSION = 1 as const;

export interface CapabilityDefinition {
    id: CapabilityId;
    contractVersion: typeof CAPABILITY_CONTRACT_VERSION;
    /** 모델 배정 대상인가(설정 화면·capability_models) */
    assignable: boolean;
    /** Planner 가 계획에 쓸 수 있는가 */
    plannable: boolean;
    display: {
        /** 한국어 라벨(i18n 은 웹이 별도 보유 — 서버 metadata 는 ko 기준) */
        label: string;
        /** 설정 화면 그룹 키(text·vision·image·audio·music·video·web) */
        group: string;
        order: number;
    };
    /** Planner 프롬프트 한 줄 설명 */
    plannerHint: string;
    /** 계획 `input` 의 추가 인자 스키마 — Planner 용 JSON schema 투영과 서버 검증이 같은 원천을 쓴다 */
    inputSchema: JsonSchema;
    /** 배정 `params` 스키마(설정 화면 위젯) */
    settingsSchema: JsonSchema;
    execution: {
        mode: 'sync' | 'job';
        timeoutMs: number;
        supportsCancellation: boolean;
    };
    output: { mimeTypes: readonly string[] };
}

export interface ModelDescriptor {
    fullId: string;
    providerId: string;
    isExternal: boolean;
}

export type SupportVerdict = { supported: true } | { supported: false; reason: string };

/**
 * Add-on handler 가 받는 실행 문맥(P04) — 승인 handle · 제한 호출 포트 · scoped Artifact 포트. 종전 `ExecContext` 에서
 * **`targets`(헤더·키 포함)·`handles` 를 뺀** 것이다: raw 자격증명은 `model` 포트 안에만 있다(T08).
 * Base 소유(legacy bridge) 실행기는 전환 기간 동안 `targets` 를 덧붙여 받는다(executor.ts).
 */
export interface CapabilityContext extends Omit<ExecContext, 'targets' | 'handles'> {
    invocation: ApprovedInvocationHandle;
    model: RestrictedModelInvoker;
    artifacts: ScopedArtifactStore;
    /** 장시간 작업의 소유·상태·중복 제출 방지(P07) — 저장소는 Base */
    jobs: ScopedJobRuntime;
    traceId: string;
}

export interface CapabilityHandler {
    /** 실행 — ctx 는 승인 handle 기반 문맥. 임의 모델·Provider·URL 을 고를 수 없다(포트가 거절) */
    execute(task: PlanTask, ctx: CapabilityContext): Promise<ExecutorOutput>;
    /** 계획 인자 정규화 hook(원문 우선 보정 등). 원문 의미를 조용히 바꾸지 않는다 — 진단은 로그로 */
    normalizePlanInput?(task: PlanTask, userMessage: string): PlanTask;
    /** 이 driver 가 배정된 모델을 지원하는가 — 배정 저장·실행 전 검사 */
    describeProviderSupport?(model: ModelDescriptor): SupportVerdict;
    /** execution.mode='job' capability 의 provider 작업 driver — 백그라운드 poller(P07b)가 재시작 뒤에도 이것으로 이어 간다 */
    jobDriver?: JobDriver;
    /** driver 가 쓰는 추가 provider 연산(경로 템플릿) — 등록 시 검증, 포트가 origin·자격증명을 붙인다 */
    operations?: Readonly<Record<string, OperationSpec>>;
}

/** 소유자는 Host 가 채운다 — 외부 입력을 신뢰하지 않는다 */
export interface CapabilityOwner {
    addonId: AddonId;
    addonVersion: string;
    source: 'builtin';
}

export interface CapabilityRegistration {
    definition: CapabilityDefinition;
    owner: CapabilityOwner;
    handler: CapabilityHandler;
}

/** Base 예약 소유자 — legacy bridge(텍스트·비전·오디오·웹·분석 계열)가 이 이름으로 등록한다 */
export const BASE_CAPABILITY_OWNER: CapabilityOwner = { addonId: 'base', addonVersion: '1', source: 'builtin' };
