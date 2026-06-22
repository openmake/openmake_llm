/**
 * ============================================================
 * UnifiedMCPClient - 통합 MCP 클라이언트
 * ============================================================
 *
 * 핵심 MCP 도구를 통합하여 대시보드, REST API, WebSocket에서 사용합니다.
 * MCPServer, ToolRouter, MCPServerRegistry를 하나의 인터페이스로 제공합니다.
 *
 * @module mcp/unified-client
 * @description
 * - MCP 도구 실행 (내장 + 외부)
 * - UserContext 기반 샌드박스 경로 변환
 * - Sequential Thinking 메시지 적용
 * - 외부 MCP 서버 초기화 (DB 연동)
 * - 외부 MCP 서버 초기화 (DB 연동)
 * - 싱글톤 인스턴스 제공
 *
 * 계층 구조:
 * UnifiedMCPClient
 * ├── MCPServer (내장 도구 JSON-RPC 처리)
 * ├── ToolRouter (내장 + 외부 도구 통합 라우팅)
 * └── MCPServerRegistry (외부 서버 연결 관리)
 */

import { MCPServer, createMCPServer } from './server';
import { MCPToolResult } from './types';
import { UserSandbox, UserContext } from './user-sandbox';
import { ToolRouter } from './tool-router';
import { MCPServerRegistry } from './server-registry';
import { getUserMCPPool } from './user-pool';
import { type UnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('MCP');

/**
 * 도구 인자 위험 패턴 룰 (best-effort defense-in-depth).
 *
 * ⚠️ 이 검증은 1차 격리 경계가 아니다 — 실제 격리는 bubblewrap OS 샌드박스(PR #153,
 *    MCP_SANDBOX_ENABLED) + 외부 MCP spawn env 비밀 차단(PR #151)이 담당한다.
 *    값 본문 전수 스캔은 정상 인자(검색어·코드 본문 등) 오탐이 커 의도적으로 하지 않고,
 *    "위험 의미가 분명한 key 이름"에만 좁은 패턴을 적용한다.
 *
 * 개선(2026-06-22): 기존엔 key 가 정확히 sql/query/command/cmd/url/href 일 때만 검사해
 *   file_path·user_command 같은 변형과 path/file 류 key 는 전부 무검사였다. key 를
 *   snake_case 경계(_ 또는 양끝) 매칭으로 넓히고, path/file key 에 민감파일 접근 패턴을 추가.
 *   (주의: 'query' 에 SQL DDL 키워드 패턴은 웹검색 등에서 오탐 가능 — 기존 동작 보존 차원 유지.)
 */
const SENSITIVE_FILE_RE = /(\.env\b|\.ssh\b|id_rsa|id_ed25519|\.aws\/credentials|\/etc\/(shadow|passwd|sudoers)|\.pem\b|\.p12\b|private[_-]?key)/i;
const DANGEROUS_ARG_RULES: ReadonlyArray<{ label: string; keyRe: RegExp; patterns: RegExp[] }> = [
    { label: 'SQL', keyRe: /(?:^|_)(sql|query)(?:_|$)/i, patterns: [/\b(DROP|ALTER|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE)\b/i] },
    { label: 'shell', keyRe: /(?:^|_)(command|cmd)(?:_|$)/i, patterns: [/[;&|`$(){}]/] },
    { label: 'URL scheme', keyRe: /(?:^|_)(url|href|uri|link|endpoint)(?:_|$)/i, patterns: [/^(file|data|javascript|vbscript):/i] },
    { label: 'sensitive-path', keyRe: /(?:^|_)(path|file|filepath|filename|dir|directory|source|dest|destination)(?:_|$)/i, patterns: [SENSITIVE_FILE_RE] },
];

/**
 * 단일 인자(key, string value)가 위험 패턴에 걸리는지 검사 (순수, 테스트 가능).
 * @returns 위반 라벨 또는 null. key 는 호출자가 소문자화하지 않아도 됨(내부 처리).
 */
export function detectDangerousArg(key: string, value: string): string | null {
    const k = key.toLowerCase();
    for (const rule of DANGEROUS_ARG_RULES) {
        if (!rule.keyRe.test(k)) continue;
        for (const p of rule.patterns) {
            if (p.test(value)) return rule.label;
        }
    }
    return null;
}

/**
 * 통합 MCP 클라이언트
 *
 * 애플리케이션 전체에서 MCP 기능을 사용하기 위한 통합 인터페이스입니다.
 * getUnifiedMCPClient()로 싱글톤 인스턴스를 사용합니다.
 *
 * @class UnifiedMCPClient
 */
export class UnifiedMCPClient {
    /** 내장 MCP 서버 (JSON-RPC 도구 처리) */
    private server: MCPServer;
    /** 내장 + 외부 도구 통합 라우터 */
    /** 내장 + 외부 도구 통합 라우터 */
    private toolRouter: ToolRouter;
    /** 외부 MCP 서버 연결 관리자 */
    private serverRegistry: MCPServerRegistry;

    /**
     * UnifiedMCPClient 인스턴스를 생성합니다.
     *
     * MCPServer, ToolRouter, MCPServerRegistry를 초기화합니다.
     */
    constructor() {
        this.server = createMCPServer('openmake-unified-mcp', '1.0.0');
        this.toolRouter = new ToolRouter({
            userPool: getUserMCPPool(),
        });
        this.serverRegistry = new MCPServerRegistry(this.toolRouter);
        logger.info(`통합 MCP 클라이언트 초기화 - ${this.getToolCount()}개 도구 등록됨`);
    }

    /**
     * 등록된 도구 수 조회
     */

    /**
     * 등록된 도구 수 조회
     */
    getToolCount(): number {
        return this.server.getTools().length;
    }

    /**
     * 모든 도구 목록 조회
     */
    getToolList(): string[] {
        return this.server.getTools().map(t => t.name);
    }

    /**
     * 도구 카테고리별 분류
     */
    getToolsByCategory(): Record<string, string[]> {
        const tools = this.server.getTools();
        const categories: Record<string, string[]> = {
            file: [],
            command: [],
            search: []
        };

        for (const tool of tools) {
            if (tool.name.includes('file')) {
                categories.file.push(tool.name);
            } else if (tool.name.includes('command')) {
                categories.command.push(tool.name);
            } else if (tool.name.includes('search')) {
                categories.search.push(tool.name);
            }
        }

        return categories;
    }

    // (제거됨) executeTool() — sanitize 검증 없이 server.handleRequest('tools/call') 를 호출하던
    //   미사용 경로. canonical 은 executeToolWithContext (sandbox·인자 sanitize 적용).
    // (제거됨) handleMCPRequest() — 미구현 SSE 핸들러용 dead code. 네트워크로 MCP 를 노출하려면
    //   handleRequest 진입점에 UserContext 존재 검증을 먼저 강제할 것.

    /**
     * 상태 초기화
     */
    reset(): void {
        logger.info('상태 초기화 완료');
    }

    /**
     * 통계 조회
     */
    getStats(): { tools: number } {
        return {
            tools: this.getToolCount()
        };
    }

    // ============================================
    // 도구 목록 조회
    // ============================================

    /**
     * 사용자 컨텍스트로 도구 실행
     */
    async executeToolWithContext(
        toolName: string,
        args: Record<string, unknown>,
        context: UserContext
    ): Promise<MCPToolResult> {
        // 파일 경로 인자가 있으면 샌드박스 경로로 변환
        let sandboxedArgs: Record<string, unknown>;
        try {
            sandboxedArgs = this.applySandboxPaths(args, context.userId);
        } catch (error) {
            const message = error instanceof Error ? error.message : '샌드박스 경로 검증 실패';
            logger.warn(`⚠️ 도구 실행 차단: ${toolName} (user: ${context.userId}) - ${message}`);
            return {
                content: [{ type: 'text', text: message }],
                isError: true
            };
        }

        // 비경로 인자 보안 검증 (SQL 인젝션, 명령어 인젝션 등)
        try {
            sandboxedArgs = this.sanitizeToolArgs(sandboxedArgs, toolName);
        } catch (error) {
            const message = error instanceof Error ? error.message : '도구 인자 검증 실패';
            logger.warn(`⚠️ 도구 인자 차단: ${toolName} (user: ${context.userId}) - ${message}`);
            return {
                content: [{ type: 'text', text: message }],
                isError: true
            };
        }

        logger.info(`🔧 도구 실행: ${toolName} (user: ${context.userId})`);
        // toolRouter 직접 호출 — JSON-RPC 래퍼(executeTool)는 context 채널이 없어
        // 사용자 스코프 내장 도구(agent_task_* 등)와 user-pool 외부 도구에 userId 가
        // 전달되지 않는다. 에이전트 루프(runTool)와 동일한 canonical 경로.
        return this.toolRouter.executeTool(toolName, sandboxedArgs, context);
    }

    // ============================================
    // 🔌 외부 MCP 서버 관련
    // ============================================

    /**
     * ToolRouter 인스턴스 반환
     */
    getToolRouter(): ToolRouter {
        return this.toolRouter;
    }

    /**
     * MCPServerRegistry 인스턴스 반환
     */
    getServerRegistry(): MCPServerRegistry {
        return this.serverRegistry;
    }

    /**
     * DB에서 외부 서버 설정을 로드하고 연결 초기화
     * 앱 시작 시 한 번 호출
     */
    async initializeExternalServers(db: UnifiedDatabase): Promise<void> {
        await this.serverRegistry.initializeFromDB(db);
    }

    /**
     * 인자 중 파일 경로를 사용자 샌드박스 경로로 변환
     *
     * path, file, directory 등 일반적인 경로 인자명을 감지하여
     * UserSandbox.resolvePath()로 안전한 절대 경로로 변환합니다.
     * 경로 탈출 시도 시 즉시 에러를 발생시켜 도구 실행을 차단합니다.
     *
     * @param args - 원본 도구 실행 인자
     * @param userId - 사용자 ID
     * @returns 샌드박스 경로가 적용된 인자 복사본
     */
    private applySandboxPaths(
        args: Record<string, unknown>,
        userId: string | number
    ): Record<string, unknown> {
        const result = { ...args };

        // 일반적인 경로 인자명
        const pathKeys = ['path', 'file', 'directory', 'dir', 'cwd', 'workdir'];

        for (const key of pathKeys) {
            if (typeof result[key] === 'string') {
                const safePath = UserSandbox.resolvePath(userId, result[key] as string);
                if (safePath) {
                    result[key] = safePath;
                } else {
                    delete result[key];
                    throw new Error(`차단된 경로 인자: ${key}`);
                }
            }
        }

        return result;
    }

    /**
     * 도구 인자에서 위험한 패턴을 검증/차단 (best-effort defense-in-depth).
     *
     * 위험 의미가 분명한 key(sql/query/command·cmd/url 류 + path/file 류)에만 좁은 패턴을
     * 적용한다. 실제 격리 경계는 bubblewrap(PR #153)·spawn env 차단(PR #151)이며, 이 함수는
     * 보조 휴리스틱이다. 상세는 모듈 상단 DANGEROUS_ARG_RULES 주석 참고.
     * 경로 인자의 샌드박스 매핑은 applySandboxPaths()에서 별도 처리.
     */
    private sanitizeToolArgs(
        args: Record<string, unknown>,
        toolName: string
    ): Record<string, unknown> {
        const result = { ...args };

        for (const [key, value] of Object.entries(result)) {
            if (typeof value !== 'string') continue;
            const violation = detectDangerousArg(key, value);
            if (violation) {
                throw new Error(`차단된 도구 인자: ${key} (도구: ${toolName}) — 위험한 패턴 감지 [${violation}]`);
            }
        }

        return result;
    }
}

/** 싱글톤 인스턴스 저장소 */
let unifiedClient: UnifiedMCPClient | null = null;

/**
 * UnifiedMCPClient 싱글톤 인스턴스 반환
 *
 * 최초 호출 시 인스턴스를 생성하고, 이후에는 동일 인스턴스를 반환합니다.
 *
 * @returns UnifiedMCPClient 싱글톤 인스턴스
 */
export function getUnifiedMCPClient(): UnifiedMCPClient {
    if (!unifiedClient) {
        unifiedClient = new UnifiedMCPClient();
    }
    return unifiedClient;
}

/**
 * 새 UnifiedMCPClient 인스턴스 생성
 *
 * 싱글톤이 아닌 독립 인스턴스가 필요한 경우 사용합니다.
 * 주로 테스트에서 사용됩니다.
 *
 * @returns 새 UnifiedMCPClient 인스턴스
 */
export function createUnifiedMCPClient(): UnifiedMCPClient {
    return new UnifiedMCPClient();
}
