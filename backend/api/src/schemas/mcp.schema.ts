/**
 * ============================================================
 * MCP Schema - Model Context Protocol Zod 검증 스키마
 * ============================================================
 *
 * MCP 도구 실행 및 외부 서버 등록 요청의 유효성을 검증하는
 * Zod 스키마와 추론된 TypeScript 타입을 정의합니다.
 *
 * @module schemas/mcp.schema
 */
import { z } from 'zod';
import { secureOptionalTextSchema, secureTextSchema } from './security.schema';

/**
 * MCP 도구 실행 스키마
 * @property {Record<string, unknown>} [arguments] - 도구 인수 (선택, 기본값: {})
 */
export const mcpToolExecuteSchema = z.object({
    arguments: z.record(z.string(), z.unknown()).optional().default({})
});

/**
 * 외부 MCP 서버 등록 스키마 (transport 유형별 조건부 검증)
 * @property {string} name - 서버 이름 (필수, 1~100자)
 * @property {'stdio'|'sse'|'streamable-http'} transport_type - Transport 타입 (필수)
 * @property {string} [command] - stdio transport 시 실행 명령어
 * @property {string[]} [args] - stdio transport 시 명령어 인수
 * @property {Record<string, string>} [env] - 환경 변수
 * @property {string} [url] - sse/streamable-http transport 시 서버 URL
 * @property {boolean} [enabled] - 서버 활성화 여부 (기본값: true)
 */
export const mcpServerCreateSchema = z.object({
    name: secureTextSchema({ minLength: 1, maxLength: 100, fieldName: 'name', allowNewLines: false, detectMaliciousPatterns: false }),
    transport_type: z.enum(['stdio', 'sse', 'streamable-http'], {
        message: "transport_type은 'stdio', 'sse', 'streamable-http' 중 하나여야 합니다"
    }),
    command: secureOptionalTextSchema({ minLength: 1, maxLength: 1000, fieldName: 'command', allowNewLines: false, detectMaliciousPatterns: false, specialCharacterRatioLimit: 0.95 }),
    args: z.array(secureTextSchema({ maxLength: 500, fieldName: 'args', allowNewLines: false, detectMaliciousPatterns: false, specialCharacterRatioLimit: 0.95 })).max(50).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().url('유효한 URL을 입력하세요').optional(),
    enabled: z.boolean().optional().default(true)
}).superRefine((data, ctx) => {
    if (data.transport_type === 'stdio' && !data.command) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'stdio transport에는 command가 필요합니다',
            path: ['command']
        });
    }
    if ((data.transport_type === 'sse' || data.transport_type === 'streamable-http') && !data.url) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${data.transport_type} transport에는 url이 필요합니다`,
            path: ['url']
        });
    }
});

/** MCP 도구 실행 요청 TypeScript 타입 */
export type McpToolExecuteInput = z.infer<typeof mcpToolExecuteSchema>;
/** MCP 서버 등록 요청 TypeScript 타입 */
export type McpServerCreateInput = z.infer<typeof mcpServerCreateSchema>;
