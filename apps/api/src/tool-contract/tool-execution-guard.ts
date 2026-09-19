/**
 * 도구 실행 보안 가드 — 샌드박스 경로 변환 · 위험 인자 차단 · 호출 감사 (Add-on 전환 P2, 2026-09-19).
 *
 * 종전에는 `UnifiedMCPClient.executeToolWithContext` 안의 private 메서드들이었다. MCP 런타임이
 * add-on 으로 나가면서, **거버넌스는 Base 에 남는다**는 원칙(§8 Sandbox abstraction·Audit = Base)에 따라
 * 여기로 뽑았다. 내장 전용 실행(Base 기본 런타임)과 MCP 런타임 add-on 이 **같은 이 함수**를 쓴다.
 *
 * ⚠️ 이 검증은 1차 격리 경계가 아니다 — 실제 격리는 docker OS 샌드박스와 spawn env 비밀 차단이 맡는다.
 *
 * @module tool-contract/tool-execution-guard
 */
import type { MCPToolResult, UserContext } from './types';
import type { ToolErrorCategory } from './tool-error-classifier';
import { UserSandbox } from './user-sandbox';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolExecutionGuard');

/**
 * 도구 인자 위험 패턴 룰 (best-effort defense-in-depth).
 *
 * 값 본문 전수 스캔은 정상 인자(검색어·코드 본문 등) 오탐이 커 의도적으로 하지 않고,
 * "위험 의미가 분명한 key 이름"에만 좁은 패턴을 적용한다.
 *
 * 개선(2026-06-22): key 를 snake_case 경계(_ 또는 양끝) 매칭으로 넓히고, path/file key 에
 *   민감파일 접근 패턴을 추가했다. (주의: 'query' 의 SQL DDL 패턴은 웹검색 등에서 오탐 가능 —
 *   기존 동작 보존 차원 유지.)
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

/** 경로 인자를 사용자 샌드박스 안의 실제 경로로 바꾼다. 밖을 가리키면 throw. */
function applySandboxPaths(args: Record<string, unknown>, userId: string | number): Record<string, unknown> {
    const result = { ...args };
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

function sanitizeToolArgs(args: Record<string, unknown>, toolName: string): Record<string, unknown> {
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

/** 도구 호출 감사 영속화 (fire-and-forget·비차단). 공개 운영 포렌식용. */
async function auditToolCall(
    toolName: string, context: UserContext, result: MCPToolResult, durationMs: number,
    classification: { errorCategory?: ToolErrorCategory; retryable?: boolean } = {},
): Promise<void> {
    try {
        const { getAuditService } = await import('../services/AuditService');
        const isExternal = toolName.includes('::');
        const rawUid = context.userId !== undefined && context.userId !== null ? String(context.userId) : undefined;
        // audit_logs.user_id 는 users FK — 게스트('guest')는 user_id=null 로 넣고 details 에 표시(FK 위반 방지).
        const isRealUser = rawUid !== undefined && rawUid !== 'guest';
        await getAuditService().logAudit({
            action: 'mcp_tool_call',
            userId: isRealUser ? rawUid : undefined,
            resourceType: isExternal ? 'mcp_external_tool' : 'mcp_builtin_tool',
            resourceId: toolName,
            details: {
                isError: result?.isError === true,
                durationMs,
                server: isExternal ? toolName.split('::')[0] : 'builtin',
                role: context.role,
                actorId: rawUid ?? 'guest',
                // 실패 분류 — 도구별 실패 원인 집계(도구 헬스)의 소스. 성공 호출엔 없다.
                ...(classification.errorCategory ? { errorCategory: classification.errorCategory } : {}),
                ...(classification.retryable !== undefined ? { retryable: classification.retryable } : {}),
            },
        });
    } catch (e) { logger.debug(`audit 기록 실패(무시): ${e instanceof Error ? e.message : String(e)}`); }
}

/**
 * 사용자 문맥이 있는 도구 실행 — 경로 샌드박스 → 인자 검증 → 실행 → 감사.
 *
 * @param exec 실제 실행자(Base 내장 디스패처 또는 MCP 런타임의 ToolRouter)
 */
export async function executeToolSecurely(
    exec: (name: string, args: Record<string, unknown>, context: UserContext) => Promise<MCPToolResult>,
    toolName: string,
    args: Record<string, unknown>,
    context: UserContext,
): Promise<MCPToolResult> {
    // 파일 경로 인자가 있으면 샌드박스 경로로 변환
    let sandboxedArgs: Record<string, unknown>;
    try {
        sandboxedArgs = applySandboxPaths(args, context.userId);
    } catch (error) {
        const message = error instanceof Error ? error.message : '샌드박스 경로 검증 실패';
        logger.warn(`⚠️ 도구 실행 차단: ${toolName} (user: ${context.userId}) - ${message}`);
        return { content: [{ type: 'text', text: message }], isError: true };
    }

    // 비경로 인자 보안 검증 (SQL 인젝션, 명령어 인젝션 등)
    try {
        sandboxedArgs = sanitizeToolArgs(sandboxedArgs, toolName);
    } catch (error) {
        const message = error instanceof Error ? error.message : '도구 인자 검증 실패';
        logger.warn(`⚠️ 도구 인자 차단: ${toolName} (user: ${context.userId}) - ${message}`);
        return { content: [{ type: 'text', text: message }], isError: true };
    }

    logger.info(`🔧 도구 실행: ${toolName} (user: ${context.userId})`);
    const startedAt = Date.now();
    const result = await exec(toolName, sandboxedArgs, context);
    // 실패 분류(디스패처가 실어 보낸 내부 전용 필드)를 감사에 넘기고 응답에서는 지운다.
    // ⚠️ 감사는 fire-and-forget 이라 result 를 나중에 읽는다 — 제거 전에 값을 꺼내 인자로 전달할 것.
    const errorCategory = result?.errorCategory;
    const retryable = result?.retryable;
    if (result) {
        delete result.errorCategory;
        delete result.retryable;
    }
    void auditToolCall(toolName, context, result, Date.now() - startedAt, { errorCategory, retryable });
    return result;
}
