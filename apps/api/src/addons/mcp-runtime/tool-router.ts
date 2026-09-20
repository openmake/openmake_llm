/**
 * ============================================================
 * ToolRouter - 통합 도구 레지스트리 및 라우터
 * ============================================================
 *
 * 내장 도구(builtInTools)와 외부 MCP 서버 도구를 하나의 인터페이스로 통합합니다.
 * 도구 이름의 네임스페이스(::)를 기반으로 내장/외부 도구를 자동 라우팅합니다.
 *
 * @module mcp/tool-router
 * @description
 * - 내장 도구와 외부 MCP 서버 도구의 통합 검색/실행
 * - '::' 네임스페이스 기반 외부 도구 라우팅 (예: "postgres::query")
 * - 외부 서버 도구의 동적 등록/해제
 *
 * @example
 * ```typescript
 * const router = new ToolRouter();
 * // 내장 도구 실행
 * const result = await router.executeTool('web_search', { query: 'hello' });
 * // 외부 도구 실행 (네임스페이스 기반 라우팅)
 * const extResult = await router.executeTool('postgres::query', { sql: 'SELECT 1' });
 * ```
 *
 * 라우팅 알고리즘:
 * 1. 도구 이름에 '::' 포함 여부 확인
 * 2. '::' 포함 → externalTools 맵에서 검색 → ExternalMCPClient로 원본 이름 호출
 * 3. '::' 미포함 → builtInTools 배열에서 검색 → 직접 handler 호출
 * 4. 양쪽 모두 미발견 → 에러 반환
 */

import type { MCPTool, MCPToolResult, ExternalToolEntry, UserContext } from '../../tool-contract/types';
import { dispatchTool, type ExternalToolDispatch } from '../../tool-contract/tool-dispatch';
import { MCP_NAMESPACE_SEPARATOR } from '../../tool-contract/types';
import type { MCPToolDefinition } from '../../tool-contract/types';
import { getBuiltInTools } from '../../tools/builtin-tools';
import { createLogger } from '../../utils/logger';
import { MCP_EXTERNAL_TOOL_LIMITS } from '../../config/timeouts';
import { inputAwareTimer } from './elicitation-bridge';
import { isConnectionDeathError } from '../../tool-contract/tool-error-classifier';
import { isToolCircuitOpen } from '../../tool-contract/tool-health';
import { withToolNameSuggestions } from '../../tool-contract/tool-name-suggest';
import type { UserMCPPool } from './user-pool';
import type { ExternalMCPClient } from './external-client';
import { collectUserPoolTools } from './user-pool-tools';
import { parallelBatch } from '../../workflow/graph-engine';
import { MCP_TOOL_REFRESH_CONCURRENCY } from '../../config/runtime-limits';

const logger = createLogger('ToolRouter');

/** 도구 결과의 텍스트 본문 — 오류 분류용 */
function resultText(result: MCPToolResult): string {
    return (result.content ?? []).map((c) => ('text' in c && typeof c.text === 'string' ? c.text : '')).join('\n');
}

/**
 * 외부 도구 실행기 함수 타입
 *
 * ExternalMCPClient.callTool을 래핑한 함수입니다.
 * ToolRouter가 외부 서버에 도구 실행을 위임할 때 사용합니다.
 *
 * @param name - 원본 도구 이름 (네임스페이스 제외)
 * @param args - 도구 실행 인자
 * @returns 도구 실행 결과
 */
type ExternalToolExecutor = (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>;

/**
 * LLM Function Calling 도구 형식 (OpenAI 호환)
 *
 * vLLM/LiteLLM 의 chat.completions.create({ tools }) 가 요구하는 형식입니다.
 * MCPTool 을 이 형식으로 변환하여 LLM 에 전달합니다.
 *
 * @interface LLMTool
 */
interface LLMTool {
    /** 도구 타입 (항상 'function') */
    type: 'function';
    /** 도구 함수 정의 */
    function: {
        /** 도구 이름 */
        name: string;
        /** 도구 설명 */
        description: string;
        /** 입력 파라미터 스키마 */
        parameters: {
            /** 스키마 타입 */
            type: string;
            /** 파라미터 속성 정의 */
            properties: Record<string, unknown>;
            /** 필수 파라미터 목록 */
            required?: string[];
        };
    };
}

/**
 * 통합 도구 레지스트리 및 라우터
 *
 * 내장 도구와 외부 MCP 서버 도구를 하나의 인터페이스로 통합합니다.
 * UnifiedMCPClient에서 인스턴스를 생성하여 사용합니다.
 *
 * @class ToolRouter
 */
export class ToolRouter implements ExternalToolDispatch {
    /** 외부 도구 레지스트리: namespacedName("서버명::도구명") → ExternalToolEntry */
    private externalTools: Map<string, ExternalToolEntry> = new Map();

    /** 외부 도구 실행기: serverId → ExternalToolExecutor 함수 */
    private externalExecutors: Map<string, ExternalToolExecutor> = new Map();

    /** Phase 7: 사용자 풀 (lifecycle-supervisor 가 채운 ExternalMCPClient 인스턴스) */
    private readonly userPool?: UserMCPPool;

    /**
     * @param deps - optional 의존성. userPool 없으면 기존 (builtin + global external) 동작과 동일.
     */
    constructor(deps?: { userPool?: UserMCPPool }) {
        this.userPool = deps?.userPool;
    }

    /**
     * 모든 도구(내장+외부) MCPTool 목록 반환
     *
     * 내장 도구는 원본 이름, 외부 도구는 네임스페이스 적용된 이름을 사용합니다.
     * userContext 가 주어지고 userPool 이 주입돼 있으면, 해당 사용자의 풀 도구도
     * displayName::tool 네임스페이스로 함께 수집합니다 (제한 없이 전체 노출).
     *
     * @param userContext - optional. 있으면 userPool 도구도 포함.
     * @returns 전체 도구 목록 (MCPTool 배열)
     */
    async getAllTools(userContext?: { userId: string }): Promise<MCPTool[]> {
        const tools: MCPTool[] = [];

        // 내장 도구
        for (const def of getBuiltInTools()) {
            tools.push(def.tool);
        }

        // 외부 도구 (네임스페이스 적용된 이름 사용)
        for (const entry of this.externalTools.values()) {
            tools.push({
                ...entry.tool,
                name: entry.namespacedName,
            });
        }

        // Phase 7: 사용자 풀 도구 — userContext + userPool 둘 다 있을 때만
        if (userContext && this.userPool) {
            await this.refreshStaleUserTools(userContext.userId);
            const userEntries = collectUserPoolTools(this.userPool, userContext.userId);
            for (const entry of userEntries) tools.push(entry.tool);
        }

        // 서킷 차단 도구는 노출하지 않는다. 이 함수가 채팅·에이전트 작업·딥리서치의
        // 공통 소스이므로 필터가 여기 한 곳이면 전 경로에 적용된다(게이트 OFF 면 no-op).
        const open = tools.filter((t) => isToolCircuitOpen(t.name));
        if (open.length > 0) {
            logger.info(`[circuit] 노출 제외 ${open.length}개: ${open.map((t) => t.name).join(', ')}`);
            const blocked = new Set(open.map((t) => t.name));
            return tools.filter((t) => !blocked.has(t.name));
        }

        return tools;
    }

    /**
     * 사용자 풀 서버의 stale 도구 목록 재조회(F13.12) — listChanged 를 광고하지 않는 서버의 안전망.
     * 동시성 4, 실패는 warn(노출 자체를 막지 않는다).
     */
    private async refreshStaleUserTools(userId: string): Promise<void> {
        if (!this.userPool) return;
        const clients = [...this.userPool.forUser(userId)].map(([, c]) => c);
        if (clients.length === 0) return;
        await parallelBatch(clients, async (c: ExternalMCPClient) => c.refreshToolsIfStale(), { concurrency: MCP_TOOL_REFRESH_CONCURRENCY })
            .catch((e: unknown) => logger.warn(`stale 도구 재조회 실패 (무시): ${e instanceof Error ? e.message : e}`));
    }

    /**
     * 사용자 풀(설치한 user MCP 서버) 도구의 네임스페이스 적용 이름 집합.
     * 채팅에서 "설치=기본 ON" 자동 노출 판별에 사용 (global 외부 도구는 제외).
     */
    /**
     * 사용자 풀 도구를 서버별로 그룹화 — displayName + 네임스페이스 도구이름 배열 + 도구
     * short name 배열. 채팅 자동 노출 선정(round-robin breadth + 의도 인식 depth)에 사용.
     * displayName/shortNames 는 사용자 메시지가 특정 서버를 언급했는지 매칭하는 데 쓴다.
     */
    getUserPoolToolGroups(userId: string): Array<{ displayName: string; tools: string[]; shortNames: string[] }> {
        if (!this.userPool) return [];
        // 카탈로그 tool_allowlist 는 **채팅 자동 노출 그룹에만** 적용 — 화이트리스트 밖 도구를
        // 여기서 제외해도 collectUserPoolTools 기반 실행 경로(REST 직접 실행·picker 명시
        // 활성화)는 전체 도구를 유지한다. 정렬은 allowlist 순서(첫 도구가 round-robin 대표).
        // 서버별로 모은 뒤 필터링 — allowlist 가 라이브 도구 이름과 하나도 매칭되지 않으면
        // (도구 rename·allowlist 오타) 서버가 그룹에서 통째로 소멸해 mcp_list_tools/mcp_call
        // 메타도구 해석까지 깨지므로, 그 경우 전체 노출로 폴백하고 경고를 남긴다.
        interface Grp { displayName: string; tools: string[]; shortNames: string[]; allowlist?: string[] }
        const byServer = new Map<string, Grp>();
        for (const e of collectUserPoolTools(this.userPool, userId)) {
            const g = byServer.get(e.serverId) ?? { displayName: e.displayName, tools: [], shortNames: [], allowlist: e.toolAllowlist };
            g.tools.push(e.tool.name);
            g.shortNames.push(e.originalToolName);
            byServer.set(e.serverId, g);
        }
        return [...byServer.values()].map(g => {
            const allow = g.allowlist;
            if (!allow?.length) return { displayName: g.displayName, tools: g.tools, shortNames: g.shortNames };
            const idx = g.shortNames
                .map((n, i) => ({ o: allow.indexOf(n), i }))
                .filter(x => x.o !== -1)
                .sort((a, b) => a.o - b.o || a.i - b.i)
                .map(x => x.i);
            if (idx.length === 0) {
                logger.warn(`tool_allowlist 0매칭 — 전체 노출 폴백: server=${g.displayName} allowlist=[${allow.join(',')}]`);
                return { displayName: g.displayName, tools: g.tools, shortNames: g.shortNames };
            }
            return {
                displayName: g.displayName,
                tools: idx.map(i => g.tools[i]),
                shortNames: idx.map(i => g.shortNames[i]),
            };
        });
    }

    /**
     * 오류 경로 전용 — 지금 이 사용자에게 실제로 열려 있는 도구 이름을 모은다.
     * 이름 교정 후보 계산에만 쓰이며, 사용자 풀 조회가 실패해도 내장·전역만으로 진행한다.
     */
    private async knownToolNamesFor(userId?: string): Promise<string[]> {
        const names: string[] = getBuiltInTools().map((d: MCPToolDefinition) => d.tool.name);
        for (const key of this.externalTools.keys()) names.push(key);
        if (userId) {
            try {
                const { getUserMCPPool } = await import('./user-pool');
                for (const e of collectUserPoolTools(getUserMCPPool(), userId)) names.push(e.tool.name);
            } catch {
                /* 사용자 풀을 못 읽어도 후보 없이 종전 메시지로 진행 (fail-open) */
            }
        }
        return names;
    }

    /** 사용자 MCP 풀 보장 — supervisor 가 없으면(부팅 전·테스트) no-op, 실패는 도구 실패로 이어지게 삼킨다 */
    private async ensureUserPool(userId: string, reason: string): Promise<void> {
        const { getLifecycleSupervisor } = await import('./lifecycle-supervisor');
        try {
            await getLifecycleSupervisor()?.ensureUserServers(userId, reason);
        } catch (e) {
            logger.warn(`사용자 MCP 풀 보장 실패 u=${userId} (${reason}): ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * 도구 실행 — 거버넌스(서킷·역할 게이트·훅·오류 분류)와 내장 도구 실행은 Base 의
     * `tool-contract/tool-dispatch` 가 맡고, 이 클래스는 외부 MCP 서버 라우팅만 책임진다.
     *
     * ⚙️ UserContext 전달 (2026-02-07): 내장 도구 handler 에 context 를 넘겨 사용자 정보를 참조하게 한다.
     */
    async executeTool(name: string, args: Record<string, unknown>, context?: UserContext): Promise<MCPToolResult> {
        return dispatchTool(name, args, context, { builtInTools: getBuiltInTools, external: this });
    }

    /** 오타 교정 제안용 — Base 디스패처가 not-found 메시지를 만들 때 부른다. */
    async knownToolNames(userId?: string): Promise<string[]> {
        return this.knownToolNamesFor(userId);
    }

    /**
     * 외부(`::`) 도구 실행 — 사용자 풀 우선, 없으면 전역 externalTools.
     * 이름을 모르면 `undefined` 를 돌려 not-found 처리를 Base 디스패처에 맡기고,
     * 실행 실패는 throw 해서 같은 곳에서 분류·기록되게 한다.
     */
    async execute(name: string, args: Record<string, unknown>, context?: UserContext): Promise<MCPToolResult | undefined> {
        // 1a. 사용자별 풀 우선 검색 (Phase 7 LifecycleSupervisor 가 채운 인스턴스)
        //     context.userId 가 있으면 user_private/user_shared 서버는 사용자 풀에서만 접근.
        if (context?.userId) {
            // 네임스페이스 이름은 `displayName::tool` 인데 풀은 serverId(mcp_*) 로 키된다.
            // split[0](displayName) 직접 조회는 항상 실패하므로(서버명 충돌 시 suffix 도
            // 붙음), collectUserPoolTools 로 전체 네임스페이스 이름을 매칭해 entry 의
            // 실제 serverId + originalToolName 으로 호출한다.
            const userId = String(context.userId);
            const { getUserMCPPool } = await import('./user-pool');
            const pool = getUserMCPPool();
            const findTarget = () => {
                const entry = collectUserPoolTools(pool, userId).find(e => e.tool.name === name);
                const client = entry ? pool.get(userId, entry.serverId) : undefined;
                return entry && client ? { entry, client } : undefined;
            };
            // 서버가 사용자 입력을 기다리는 동안(elicitation, F13.10)은 마감을 다시 건다
            const callTarget = (t: NonNullable<ReturnType<typeof findTarget>>) => Promise.race([
                t.client.callTool(t.entry.originalToolName, args),
                new Promise<never>((_, reject) => inputAwareTimer(MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS, () => t.client.isAwaitingInput?.() ?? false,
                    () => reject(new Error(`외부 도구 타임아웃: ${name} (${MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS}ms 초과)`)))),
            ]);
            // 끊긴 사용자 서버 복구 — stdio 자식은 유휴 종료(open-design MCP 30분) 등으로 조용히 죽는다.
            // 끊긴 client 는 빼고, 풀에 없는데 전역 도구도 아니면 풀을 보장한 뒤 다시 찾는다(2026-09-15).
            let target = findTarget();
            if (target && target.client.getStatus().status !== 'connected') {
                await pool.remove(userId, target.entry.serverId);
                target = undefined;
            }
            if (!target && !this.externalTools.has(name)) {
                await this.ensureUserPool(userId, 'tool-call');
                target = findTarget();
            }
            if (target) {
                try {
                    let result = await callTarget(target);
                    // 종료 감지보다 호출이 먼저 닿은 경우 — 빼고 새로 띄워 1회만 재시도한다.
                    if (result?.isError && isConnectionDeathError(resultText(result))) {
                        logger.warn(`사용자 MCP 연결 끊김 — 재기동 후 재시도: ${name}`);
                        await pool.remove(userId, target.entry.serverId);
                        await this.ensureUserPool(userId, 'tool-retry');
                        const retry = findTarget();
                        if (retry) result = await callTarget(retry);
                    }
                    return result;
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    throw new Error(`사용자 풀 도구 실행 실패 (${name}): ${msg}`);
                }
            }
        }

        // 1b. 전역 externalTools (visibility=global) fallback
        const externalEntry = this.externalTools.get(name);
        if (!externalEntry) return undefined; // not-found 메시지는 Base 디스패처가 만든다(이름 제안 포함)

        const executor = this.externalExecutors.get(externalEntry.serverId);
        if (!executor) {
            throw new Error(`서버 "${externalEntry.serverName}"의 실행기를 찾을 수 없습니다.`);
        }

        // 외부 도구 실행 (타임아웃 — 출력 크기 제한은 Base 디스패처가 적용)
        return Promise.race([
            executor(externalEntry.originalName, args),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`외부 도구 타임아웃: ${name} (${MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS}ms 초과)`)), MCP_EXTERNAL_TOOL_LIMITS.EXECUTION_TIMEOUT_MS)
            )
        ]);
    }

    /**
     * LLM Function Calling 도구 형식으로 변환 (OpenAI 호환)
     *
     * MCPTool 형식을 vLLM/LiteLLM chat.completions.create({ tools }) 가 요구하는
     * 형식으로 변환합니다. 모든 도구를 제한 없이 노출합니다.
     *
     * @param userContext - optional. 있으면 userPool 도구도 포함.
     * @returns OpenAI 호환 tools 배열
     */
    async getLLMTools(userContext?: { userId: string }): Promise<LLMTool[]> {
        const tools = await this.getAllTools(userContext);
        return tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: tool.inputSchema.type,
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required,
                },
            },
        }));
    }

    /**
     * 외부 서버의 도구 일괄 등록
     *
     * 기존에 동일 serverId로 등록된 도구가 있으면 먼저 해제한 후,
     * 새로운 도구를 네임스페이스("서버명::도구명") 형식으로 등록합니다.
     *
     * @param serverId - 서버 고유 ID
     * @param serverName - 서버 이름 (네임스페이스 접두사로 사용)
     * @param tools - 등록할 도구 목록
     * @param executor - 도구 실행기 함수 (ExternalMCPClient.callTool 래퍼)
     */
    registerExternalTools(
        serverId: string,
        serverName: string,
        tools: MCPTool[],
        executor: ExternalToolExecutor
    ): void {
        // 기존 도구 먼저 해제
        this.unregisterExternalTools(serverId);

        // 실행기 등록
        this.externalExecutors.set(serverId, executor);

        // 도구 등록 (네임스페이스 적용)
        for (const tool of tools) {
            const namespacedName = `${serverName}${MCP_NAMESPACE_SEPARATOR}${tool.name}`;
            const entry: ExternalToolEntry = {
                serverId,
                serverName,
                originalName: tool.name,
                namespacedName,
                tool,
            };
            this.externalTools.set(namespacedName, entry);
        }

        logger.info(`Registered ${tools.length} tools from "${serverName}" (serverId: ${serverId})`);
    }

    /**
     * 외부 서버의 도구 일괄 해제
     *
     * 해당 serverId에 속한 모든 도구를 externalTools 맵에서 제거하고,
     * 실행기도 externalExecutors 맵에서 삭제합니다.
     *
     * @param serverId - 해제할 서버 ID
     */
    unregisterExternalTools(serverId: string): void {
        const keysToRemove: string[] = [];
        for (const [key, entry] of this.externalTools) {
            if (entry.serverId === serverId) {
                keysToRemove.push(key);
            }
        }

        for (const key of keysToRemove) {
            this.externalTools.delete(key);
        }

        this.externalExecutors.delete(serverId);

        if (keysToRemove.length > 0) {
            logger.info(`Unregistered ${keysToRemove.length} tools for serverId: ${serverId}`);
        }
    }

    /**
     * 등록된 외부 도구 수
     *
     * @returns 현재 등록된 외부 도구의 총 수
     */
    getExternalToolCount(): number {
        return this.externalTools.size;
    }

    /**
     * 내장 도구 수
     *
     * @returns builtInTools 배열의 길이
     */
    getBuiltInToolCount(): number {
        return getBuiltInTools().length;
    }

    /**
     * 특정 도구가 외부 도구인지 확인
     *
     * 도구 이름에 네임스페이스 구분자('::')가 포함되어 있는지 검사합니다.
     *
     * @param name - 확인할 도구 이름
     * @returns 외부 도구이면 true
     */
    isExternalTool(name: string): boolean {
        return name.includes(MCP_NAMESPACE_SEPARATOR);
    }
}
