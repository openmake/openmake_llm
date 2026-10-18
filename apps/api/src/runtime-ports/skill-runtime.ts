/**
 * Skill Runtime 포트 — Base 가 아는 스킬 계약 (Add-on 전환 P1, 2026-09-19).
 *
 * 스킬 **런타임 구현**(매니페스트 주입 계획·트리거 매칭·카탈로그·사용 기록)은 Base 가 아니라
 * `addons/skill-runtime/` 이 가지고 있고, 부팅 때 `registerSkillRuntime()` 으로 이 포트에 꽂는다.
 * Base(채팅 시스템 프롬프트·에이전트 작업·슬래시 명령)는 이 인터페이스만 알고 add-on 모듈을 import 하지 않는다
 * (`config/addon-boundary.ts` 의 경로 규칙, `addon-boundary.test.ts` 가 고정).
 *
 * 등록이 없으면(= 스킬 add-on 이 꺼진 배포) NULL 구현이 선다 — 주입 0건, 기록 no-op, 카탈로그 없음.
 * 스킬이 없는 것은 오류가 아니므로 Base 경로는 전부 그대로 돈다.
 *
 * ⚠️ 2026-10-18 부터 저장소 계층도 add-on 이다 — 테이블 정의는 코어 마이그레이션에 남지만(arch_plan S3 의 스키마 위치)
 * 소유 코드는 `addons/skill-runtime/data/` 이고 Base 는 SQL 을 쓰지 않는다(`config/addon-boundary.ts` `ADDON_OWNED_CORE_TABLES`).
 * 종전 결정("저장은 Base, 판단은 add-on", 2026-09-19)을 사용자 결정으로 바꿨다.
 *
 * @module runtime-ports/skill-runtime
 */
import type {
    LOAD_SKILL_TOOL_NAME as CONTRACT_LOAD_SKILL_TOOL_NAME,
    ActiveSkillBinding, ManifestPromptResult, SkillCatalogOptions, SkillRecordDTO, SkillSummary, SkillUsageEvent,
} from '@openmake/plugin-contracts';
import type { ToolDefinition } from '../llm/types';
import type { ProceduralHooks } from '../services/task-sandbox/tools-procedural';
import { createLogger } from '../utils/logger';

const logger = createLogger('SkillRuntimePort');

/**
 * `load_skill` 도구 이름 — 스킬 계약의 일부라 Base 도 안다(도구 노출 판단·승인 게이트가 이름으로 센다).
 * 도구의 **구현**은 add-on 에 있고 내장 도구 기여로 실린다.
 * 값은 Base 가 들고 타입은 계약(`@openmake/plugin-contracts`)에 고정한다(API 는 계약 패키지를 런타임에 require 하지 않는다).
 */
export const LOAD_SKILL_TOOL_NAME: typeof CONTRACT_LOAD_SKILL_TOOL_NAME = 'load_skill';

/**
 * 스킬 포트의 값 DTO — 정의는 계약 패키지(3차 C2), 여기서는 재수출만 한다.
 * 스킬 행은 저장소 모양 대신 `SkillRecordDTO`(직렬화 가능한 계약 모양)로 넘긴다 — 변환은 `runtime-ports/contract-mappers.ts`.
 * `ActiveSkillBinding` 은 services/chat-service/tool-merger.ts 의 같은 이름 타입과 짝이다.
 */
export type {
    ActiveSkillBinding, ManifestPromptResult, SkillCatalogOptions, SkillRecordDTO, SkillSummary, SkillUsageEvent,
    SkillUsageKind, SkillUsageStatus,
} from '@openmake/plugin-contracts';

/**
 * Base 가 스킬에게 요구하는 전부. 구현은 add-on 이고, 여기 없는 기능(생성·초안·내보내기·배정 API)은
 * add-on 안에서 자기 라우트로 처리한다 — Base 는 그것을 모른다.
 */
export interface SkillRuntime {
    /** 시스템 프롬프트에 실을 매니페스트 블록. 주입할 것이 없으면 null */
    buildManifestPrompt(
        agentId: string, userId?: string, agentCategory?: string, query?: string,
        options?: { offerOnOverflow?: boolean },
    ): Promise<ManifestPromptResult | null>;
    /** 레거시(매니페스트 미보유) 경로 — agent 에 배정된 스킬 목록과 그 프롬프트 */
    getSkillsForAgent(agentId: string, userId?: string, agentCategory?: string): Promise<SkillRecordDTO[]>;
    buildSkillPrompt(agentId: string, userId?: string, agentCategory?: string): Promise<string>;
    /** 활성 스킬의 도구 binding — 도구 머지(tool-merger)에 쓰인다 */
    getActiveSkillBindings(agentId: string, userId?: string): Promise<ActiveSkillBinding[]>;
    /** 도구 목록의 `load_skill` 을 카탈로그가 실린 정의로 교체(없으면 제거) */
    applyCatalogToTools(tools: ToolDefinition[], allTools: ToolDefinition[], opts?: SkillCatalogOptions): Promise<ToolDefinition[]>;
    /** 지정한 skill_id 들의 프롬프트 — 외부 provider 경로가 쓴다 */
    buildSkillPromptForIds(skillIds: string[], userId?: string): Promise<string>;
    /** active 스킬 검색 — 슬래시 명령(`/slug`)의 해석기가 쓴다. 매칭 규칙은 Base(chat/slash-command)에 있다 */
    searchActiveSkills(opts: { search: string; limit: number; userId?: string }): Promise<SkillSummary[]>;
    /** 사용 이벤트 기록 — 절대 throw 하지 않고 await 도 필요 없다 */
    recordUsage(events: SkillUsageEvent[]): void;
    /** 주입 상한 초과 턴에 후보를 목록으로 넘겨 모델이 load_skill 로 고르게 할지 */
    isOfferEnabled(): boolean;
    /**
     * 에이전트 작업 절차 스킬(`skill_save`·`skill_run`)의 저장·조회 훅 — 작업 소유자에 묶는다. 절차는 스킬 테이블에 저장되므로
     * 스킬 add-on 이 맡는다(2026-10-18 저장 계층 이전). 없으면 undefined — 작업 도구에 절차 스킬을 노출하지 않는다.
     */
    proceduralHooks(userId: string): ProceduralHooks | undefined;
    /** 작업 시스템 프롬프트의 절차 스킬 안내 블록(목표와 비슷한 저장 절차) — 없으면 빈 문자열 */
    buildProceduralSkillBlock(userId: string, goal: string): Promise<string>;
}

/** 스킬 add-on 이 꺼졌을 때의 구현 — Base 경로를 막지 않는다 */
const NULL_SKILL_RUNTIME: SkillRuntime = {
    async buildManifestPrompt() { return null; },
    async getSkillsForAgent() { return []; },
    async buildSkillPrompt() { return ''; },
    async getActiveSkillBindings() { return []; },
    async applyCatalogToTools(tools) { return tools; },
    async buildSkillPromptForIds() { return ''; },
    async searchActiveSkills() { return []; },
    recordUsage() { /* no-op */ },
    isOfferEnabled() { return false; },
    proceduralHooks() { return undefined; },
    async buildProceduralSkillBlock() { return ''; },
};

let runtime: SkillRuntime | null = null;

/** 스킬 add-on 부팅 진입점이 호출한다. 두 번 호출하면 마지막 것이 선다(테스트에서 교체 가능). */
export function registerSkillRuntime(impl: SkillRuntime): void {
    if (runtime) logger.debug('Skill Runtime 재등록 — 이전 구현을 교체한다');
    runtime = impl;
}

/** 테스트 정리용 — 등록을 지워 NULL 구현으로 되돌린다. */
export function resetSkillRuntime(): void {
    runtime = null;
}

/** 등록 여부. Base 는 이것을 분기 조건으로 쓰지 않는다(없으면 NULL 구현이 알아서 빈 값을 준다). */
export function isSkillRuntimeRegistered(): boolean {
    return runtime !== null;
}

export function getSkillRuntime(): SkillRuntime {
    return runtime ?? NULL_SKILL_RUNTIME;
}
