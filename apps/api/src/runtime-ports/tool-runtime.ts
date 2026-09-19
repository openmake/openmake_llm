/**
 * Tool Runtime 포트 — Base 가 아는 도구 실행 계약 (Add-on 전환 P2, 2026-09-19).
 *
 * Base 는 **내장 도구만** 실행할 수 있다(기본 구현). 외부 MCP 서버 연결·수명주기·샌드박스·사용자 풀은
 * `addons/mcp-runtime/` 이 가지고 있고, 부팅 때 `registerToolRuntime()` 으로 이 포트를 대체한다.
 *
 * 등록이 없으면(= MCP add-on 이 꺼진 배포) 내장 도구만 노출·실행되고, `::` 네임스페이스 도구는
 * "실행할 런타임이 없습니다" 로 떨어진다. 채팅·에이전트 작업·아티팩트 경로는 그대로 돈다.
 *
 * ⚠️ 거버넌스(서킷·역할 게이트·훅·오류 분류·경로 샌드박스·인자 검증·감사)는 어느 쪽이든 Base 를 통과한다
 * (`tool-contract/tool-dispatch` + `tool-contract/tool-execution-guard`). add-on 은 외부 라우팅만 더한다.
 *
 * @module runtime-ports/tool-runtime
 */
import type { MCPToolResult, UserContext } from '../tool-contract/types';
import type { ToolDefinition } from '../llm/types';
import { dispatchTool } from '../tool-contract/tool-dispatch';
import { executeToolSecurely } from '../tool-contract/tool-execution-guard';
import { getBuiltInTools } from '../tools/builtin-tools';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolRuntimePort');

/**
 * 승인함에 올라가는 "도구가 사용자에게 묻는 질문" 의 도구 이름 — `config/tool-policy` 등급표·
 * `HITL_ALWAYS_WAIT_TOOLS` 와 짝이다. 이름은 MCP elicitation 시절 그대로 유지한다(DB 저장값 호환).
 */
export const TOOL_USER_INPUT_APPROVAL_NAME = 'mcp_elicit';

export interface ToolUserInputResult {
    decision: 'approved' | 'rejected';
    /** rejected 사유 — 'user' 만 명시 거절(decline), 나머지(timeout·abort)는 cancel */
    reason?: string;
    text?: string;
}

/** 실행 중 도구가 사용자에게 물을 수 있는 문맥 — 승인 레지스트리 배선은 호출부(turn-executor)가 묶어 준다. */
export interface ToolUserInputContext {
    taskId: string;
    ask(args: Record<string, unknown>): Promise<ToolUserInputResult>;
}

/** 도구 목록의 최소 표현 — 소켓 API 가 쓴다(`::` 는 외부 도구). */
export interface ToolSummary {
    name: string;
    description: string;
    external: boolean;
}

export interface ToolRuntime {
    /** LLM function-calling 형식의 도구 목록. userContext 가 있으면 그 사용자의 외부 도구도 포함된다. */
    listLLMTools(userContext?: { userId: string }): Promise<ToolDefinition[]>;
    /** 사용자 문맥이 있는 도구 실행 — 경로 샌드박스·인자 검증·감사를 통과한다. */
    executeTool(name: string, args: Record<string, unknown>, context: UserContext): Promise<MCPToolResult>;

    // 세션 수명주기 — 외부 MCP 서버 풀을 띄우고 내리는 신호. 내장 전용 런타임에서는 no-op.
    onUserLogin(userId: string): Promise<void>;
    onUserLogout(userId: string): Promise<void>;
    onChatStart(userId: string, chatId: string): Promise<void>;
    onChatEnd(userId: string, chatId: string): Promise<void>;
    /**
     * 에이전트 작업 실행 직전 사용자 도구 보장 — 채팅과 달리 **반드시 await** 해야 한다.
     * 일회성 실행이라 도구 목록을 모으는 시점에 풀이 비어 있으면 그 실행 내내 사용자 MCP 도구가 없다.
     */
    ensureUserToolsForTask(userId: string, taskId: string): Promise<void>;
    /**
     * 특정 사용자 MCP 서버의 도구를 이름 그대로 호출 — **자기 서버를 소유한 통합 add-on** 이 쓴다
     * (네임스페이스 라우팅을 거치지 않는다). 외부 런타임이 없으면 `null` 을 돌려 호출부가 503 을 낸다.
     */
    callUserServerTool(userId: string, serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult | null>;
    /**
     * 모델이 부른 도구 호출을 실제 실행 대상으로 정규화한다 — 메타 도구(`mcp_call` 처럼 다른 도구를 감싸는 형태)를
     * 푸는 자리. 런타임이 없거나 감쌀 것이 없으면 입력 그대로 돌려준다(순수 함수).
     */
    normalizeToolCall(name: string, args: Record<string, unknown>): { name: string; args: Record<string, unknown> };
    /**
     * 사용자 외부 도구의 서버별 묶음 — "설치=기본 ON" 자동 노출(cap·breadth slot)의 입력.
     * 내장 전용 런타임에는 외부 서버가 없으므로 빈 배열.
     */
    getUserToolGroups(userId: string): Array<{ displayName: string; tools: string[]; shortNames: string[] }>;
    /** 이름·설명만 필요한 목록(소켓 agents API) */
    listTools(userContext?: { userId: string }): Promise<ToolSummary[]>;
    /**
     * 도구가 실행 중 사용자에게 물을 수 있는 문맥 안에서 fn 을 돌린다(MCP elicitation).
     * 내장 전용 런타임은 묻는 도구가 없으므로 fn 을 그대로 돌린다.
     */
    runWithUserInputContext<T>(ctx: ToolUserInputContext, fn: () => Promise<T>): Promise<T>;
    /**
     * HTTP listen 이 끝난 뒤 1회 — 외부 프로세스 감독(사용자 MCP 풀 수명주기)을 시작한다.
     * listen 전에는 포트 점유 없이 죽을 수 있어 감독을 걸지 않는다(cli cluster·직접 실행 공통).
     */
    onServerReady(): Promise<void>;
    /** graceful shutdown — 외부 프로세스·연결 정리 */
    shutdown(): Promise<void>;
}

function toLLMTool(name: string, description: string, parameters: unknown): ToolDefinition {
    return { type: 'function', function: { name, description, parameters } } as ToolDefinition;
}

/** 내장 도구만 아는 기본 런타임 — MCP add-on 이 없을 때의 Base 동작. */
const BUILTIN_ONLY_RUNTIME: ToolRuntime = {
    async listLLMTools(): Promise<ToolDefinition[]> {
        return getBuiltInTools().map(def => toLLMTool(def.tool.name, def.tool.description, def.tool.inputSchema));
    },
    async executeTool(name, args, context) {
        return executeToolSecurely(
            (toolName, sandboxedArgs, ctx) => dispatchTool(toolName, sandboxedArgs, ctx, { builtInTools: getBuiltInTools }),
            name, args, context,
        );
    },
    async listTools(): Promise<ToolSummary[]> {
        return getBuiltInTools().map(def => ({ name: def.tool.name, description: def.tool.description, external: false }));
    },
    async callUserServerTool(): Promise<MCPToolResult | null> { return null; },
    normalizeToolCall(name, args) { return { name, args }; },
    getUserToolGroups() { return []; },
    async runWithUserInputContext<T>(_ctx: ToolUserInputContext, fn: () => Promise<T>): Promise<T> { return fn(); },
    async onUserLogin() { /* no-op */ },
    async onUserLogout() { /* no-op */ },
    async onChatStart() { /* no-op */ },
    async onChatEnd() { /* no-op */ },
    async ensureUserToolsForTask() { /* no-op */ },
    async onServerReady() { /* no-op */ },
    async shutdown() { /* no-op */ },
};

let runtime: ToolRuntime | null = null;

export function registerToolRuntime(impl: ToolRuntime): void {
    if (runtime) logger.debug('Tool Runtime 재등록 — 이전 구현을 교체한다');
    runtime = impl;
}

/** 테스트 정리용 — 등록을 지워 내장 전용 런타임으로 되돌린다. */
export function resetToolRuntime(): void {
    runtime = null;
}

/** 외부 MCP 런타임이 붙었는지. 라우트·관리 화면이 "MCP 기능 없음" 을 알릴 때만 쓴다. */
export function isExternalToolRuntimeRegistered(): boolean {
    return runtime !== null;
}

export function getToolRuntime(): ToolRuntime {
    return runtime ?? BUILTIN_ONLY_RUNTIME;
}
