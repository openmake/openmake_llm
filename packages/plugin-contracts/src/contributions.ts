/**
 * 기여 계약 — capability·스킬·도구 포트가 주고받는 값 DTO (설계 3차 §3 C2). 타입과 상수만 둔다.
 *
 * capability 실행 문맥 DTO 는 capability 이름 형 `C` 를 받는다 — Base 는 자기 capability 합집합으로 좁혀 쓰고,
 * add-on 은 기본값(string)으로 쓴다. Base 오케스트레이터 타입과 같은 모양인지는 apps/api
 * `__tests__/plugin-contracts-compat.test.ts` 가 tsc 로 고정한다.
 *
 * @module plugin-contracts/contributions
 */

// ── capability metadata ──────────────────────────────────────────────

export type CapabilityId = string;
export type AddonId = string;
export type JsonSchema = Readonly<Record<string, unknown>>;

/** capability 계약 버전 — 매니페스트 `requires.capabilityContract` 와 대조한다(필드 추가만은 같은 버전) */
export const CAPABILITY_CONTRACT_VERSION = 1 as const;

export interface CapabilityDefinition {
    id: CapabilityId;
    contractVersion: typeof CAPABILITY_CONTRACT_VERSION;
    /** 모델 배정 대상인가(설정 화면·model_assignments) */
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

/**
 * 직결 선언. `api: 'native'` 는 provider 의 OpenAI 호환 주소가 아니라 카탈로그에 고정된 네이티브 API 를 쓴다는 뜻이다.
 * add-on 은 "네이티브를 쓴다"만 고르고 주소·헤더 이름은 정하지 못한다.
 */
export interface DirectTransport { endpoint: string; api?: 'native' }

/** provider 지원 판정 — `direct` 는 앱이 provider 에 직결해야 함을 선언한다(주소는 서버 통제 값뿐) */
export type SupportVerdict = { supported: true; direct?: DirectTransport } | { supported: false; reason: string };

/** 소유자는 Host 가 채운다 — 외부 입력을 신뢰하지 않는다 */
export interface CapabilityOwner {
    addonId: AddonId;
    addonVersion: string;
    source: 'builtin';
}

// ── capability 실행 문맥 ──────────────────────────────────────────────

/** 계획의 작업 하나 — Planner 출력이 검증·정규화된 것 */
export interface CapabilityTaskDTO<C extends string = string> {
    id: string;
    capability: C;
    instruction: string;
    /** 확정 콘텐츠(TTS 낭독문 등) — 지시문(instruction)과 구분 */
    text: string;
    attachments: string[];
    refs: string[];
    dependsOn: string[];
    /** passthrough 로 들어온 추가 인자(size·voice 등) — 실행기가 화이트리스트로 걸러 쓴다 */
    extra: Record<string, unknown>;
}

export type CapabilityAttachmentKind = 'image' | 'audio' | 'video' | 'document' | 'other' | 'job';

/** Planner·실행기가 보는 첨부 하나 — 사용자 첨부(a*) 또는 직전 턴 생성 미디어(m*) */
export interface CapabilityAttachmentDTO<C extends string = string> {
    id: string;
    kind: CapabilityAttachmentKind;
    name: string;
    mime: string;
    /** base64 원본(이미지 dataURL 포함) — 사용자 첨부 */
    base64?: string;
    /** `/generated/<file>` — 직전 턴 생성 미디어 */
    urlPath?: string;
    /** 텍스트 문서면 추출 텍스트 */
    text?: string;
    /** kind=job: 진행 중이던 비동기 작업 — 재조회용 */
    job?: { capability: C; providerId: string; jobId: string; resultPath?: string | null; sameConversation?: boolean };
}

export interface CapabilityMediaDTO {
    kind: 'image' | 'audio' | 'video';
    urlPath: string;
    /** 답변에 그대로 넣을 마크다운 */
    markdown: string;
}

export type CapabilityTaskStatus = 'completed' | 'pending' | 'failed' | 'skipped';

export interface CapabilityTaskUsageDTO {
    promptTokens?: number;
    completionTokens?: number;
    /** 비토큰 출력 단위(이미지 수·합성 글자 수·오디오 바이트·영상 초) */
    units?: { kind: 'images' | 'chars' | 'audio_bytes' | 'video_seconds'; count: number };
}

export interface CapabilityTaskResultDTO<C extends string = string> {
    taskId: string;
    capability: C;
    /** ok = completed 만 */
    ok: boolean;
    status: CapabilityTaskStatus;
    /** 종합 모델에 넘길 텍스트 결과 */
    text: string;
    media: CapabilityMediaDTO[];
    /** 실행 모델 fullId(관측) */
    model?: string;
    ms: number;
    error?: string;
    usage?: CapabilityTaskUsageDTO;
}

/** 진행 이벤트(WS) */
export type CapabilityProgressEventDTO<C extends string = string> =
    | { type: 'orchestrator_status'; phase: 'planning' | 'executing' | 'synthesizing' | 'done' | 'skipped'; detail?: string }
    | { type: 'orchestrator_plan'; complexity: 'simple' | 'multi'; tasks: Array<{ id: string; capability: C; instruction: string }> }
    | { type: 'orchestrator_task'; id: string; capability: C; status: 'running' | 'ok' | 'pending' | 'failed'; summary?: string; ms?: number; model?: string };

/** capability handler 가 받는 실행 문맥 중 Base 포트를 뺀 부분(포트는 Base 가 더한다) */
export interface CapabilityExecContextDTO<C extends string = string> {
    userId?: string;
    lang: string;
    /** 사용자 원문 */
    userMessage: string;
    /** 최근 답변 본문(최신 순) */
    recentAssistantMessages?: readonly string[];
    attachments: Map<string, CapabilityAttachmentDTO<C>>;
    /** 앞선 작업 결과(refs 해석) */
    results: Map<string, CapabilityTaskResultDTO<C>>;
    signal?: AbortSignal;
    /** 이 턴의 대화 id */
    sessionId?: string;
    /** 진행 이벤트 — 없으면 무시 */
    onProgress?: (event: CapabilityProgressEventDTO<C>) => void;
}

/** handler 의 실행 결과 */
export type CapabilityExecutorOutputDTO = Omit<CapabilityTaskResultDTO, 'taskId' | 'capability' | 'ms' | 'status'>
    & { status?: CapabilityTaskStatus; job?: { providerId: string; jobId: string } };

// ── 스킬 포트 ────────────────────────────────────────────────────────

/** `load_skill` 도구 이름 — 스킬 계약의 일부라 Base 도 안다(도구 노출 판단·승인 게이트가 이름으로 센다) */
export const LOAD_SKILL_TOOL_NAME = 'load_skill' as const;

/** 스킬 한 개 — 포트가 add-on·Base 사이에 넘기는 직렬화 가능한 모양(시각은 ISO 8601 문자열) */
export interface SkillRecordDTO {
    id: string;
    name: string;
    description: string;
    content: string;
    category: string;
    isPublic: boolean;
    status: 'draft' | 'active' | 'archived' | null;
    sourcePath: string | null;
    /** 확장 번들 설치분이면 그 확장 id */
    extensionId: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
}

/** 활성화된 skill 의 단일 도구 binding row */
export interface ActiveSkillBinding {
    skill_id: string;
    skill_version: string;
    tool_name: string;
    binding_mode: 'required' | 'allowed' | 'denied';
}

export type SkillUsageKind = 'slash' | 'load_skill' | 'inject' | 'skill_run';
export type SkillUsageStatus = 'ok' | 'error' | 'denied';

export interface SkillUsageEvent {
    skillId: string;
    kind: SkillUsageKind;
    userId?: string | null;
    /** skill_manifests.version — 모르면 'legacy' */
    skillVersion?: string | null;
    /** 해시만 저장 (원문 미보관) */
    args?: unknown;
    status?: SkillUsageStatus;
    durationMs?: number | null;
}

/** 매니페스트 주입 결과 — prompt 와 실제로 주입된 스킬 이름 */
export interface ManifestPromptResult {
    prompt: string;
    skillNames: string[];
}

/** 슬래시 명령 해석에 필요한 최소 스킬 정보 */
export interface SkillSummary {
    id: string;
    name: string;
    content: string;
}

export interface SkillCatalogOptions {
    /** 이미 시스템 프롬프트로 전문 주입된 스킬 id — 카탈로그에서 제외 */
    excludeIds?: ReadonlySet<string>;
    /** 본인 소유 비공개 스킬을 카탈로그에 포함하기 위한 사용자 id */
    userId?: string;
}

// ── 도구 포트 ────────────────────────────────────────────────────────

/** 승인함에 올라가는 "도구가 사용자에게 묻는 질문" 의 도구 이름(DB 저장값 호환으로 MCP elicitation 시절 이름 유지) */
export const TOOL_USER_INPUT_APPROVAL_NAME = 'mcp_elicit' as const;

export interface ToolUserInputResult {
    decision: 'approved' | 'rejected';
    /** rejected 사유 — 'user' 만 명시 거절(decline), 나머지(timeout·abort)는 cancel */
    reason?: string;
    text?: string;
}

/** 실행 중 도구가 사용자에게 물을 수 있는 문맥 */
export interface ToolUserInputContext {
    taskId: string;
    ask(args: Record<string, unknown>): Promise<ToolUserInputResult>;
}

/** 도구 목록의 최소 표현(`::` 는 외부 도구) */
export interface ToolSummary {
    name: string;
    description: string;
    external: boolean;
}
