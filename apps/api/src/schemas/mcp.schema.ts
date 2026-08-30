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
    url: z.url('유효한 URL을 입력하세요').optional(),
    enabled: z.boolean().optional().default(true),
    // visibility 분기 — 미포함 시 Zod 가 strip 하여 핸들러가 항상 global 로 생성(private 요청 무력화) 하던 결함 수정
    visibility: z.enum(['global', 'user_private', 'user_shared']).optional(),
    catalog_template_id: z.string().max(200).optional()
}).superRefine((data, ctx) => {
    if (data.transport_type === 'stdio' && !data.command) {
        ctx.addIssue({
            code: 'custom',
            message: 'stdio transport에는 command가 필요합니다',
            path: ['command']
        });
    }
    if ((data.transport_type === 'sse' || data.transport_type === 'streamable-http') && !data.url) {
        ctx.addIssue({
            code: 'custom',
            message: `${data.transport_type} transport에는 url이 필요합니다`,
            path: ['url']
        });
    }
});

/**
 * 기존 MCP 서버의 env 교체 (자격증명 로테이션) 요청 스키마.
 *
 * 부분 갱신이라 전달된 키만 바뀐다. 빈 문자열은 거부 — "값을 지운다"와 "안 바꾼다"가
 * 구분되지 않아 실수로 자격증명을 날리는 경로가 되기 때문이며, 안 바꿀 키는 아예 빼면 된다.
 * 키 이름은 환경변수 관례(영문 대문자/숫자/밑줄)로 제한해 spawn 인자 오염을 차단한다.
 */
export const mcpServerEnvUpdateSchema = z.object({
    env: z.record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '환경변수 키 형식이 올바르지 않습니다').max(100),
        z.string().min(1, '값은 비울 수 없습니다').max(10000),
    ).refine((v) => Object.keys(v).length > 0, { message: '변경할 환경변수를 1개 이상 지정하세요' })
        .refine((v) => Object.keys(v).length <= 30, { message: '한 번에 최대 30개까지 변경할 수 있습니다' }),
});

/**
 * MCP 서버 사용 여부 토글 (PATCH /api/mcp/servers/:id/enabled)
 *
 * `enabled=false` 는 "이 서버를 쓰지 않는다"는 사용자 의사표시다 — 삭제와 달리 되돌릴 수
 * 있어, 연결이 안 되는 서버(예: OAuth 미지원 원격 MCP)를 목록에서 치우되 설정은 보존한다.
 */
export const mcpServerEnabledUpdateSchema = z.object({
    enabled: z.boolean(),
});

/**
 * MCP 서버 자동 연결 토글 (PATCH /api/mcp/servers/:id/auto-spawn)
 *
 * `auto_spawn=true` 면 로그인/채팅 시작/재시작 복구 때 supervisor 가 알아서 띄운다.
 * false 는 "필요할 때만 손으로 [연결]" — 사용 여부(`enabled`)와는 별개 축.
 */
export const mcpServerAutoSpawnUpdateSchema = z.object({
    auto_spawn: z.boolean(),
});

/**
 * 서버 이름 변경 요청 스키마.
 *
 * 이름은 곧 **도구 네임스페이스**(displayName::tool)이자 tool-merger 의 의도 매칭 키다.
 * 같은 카탈로그 템플릿을 여러 접속처에 설치할 때 서로 구분하는 유일한 수단이라, 설치 후에도
 * 바꿀 수 있어야 한다. 문자 집합은 from-catalog 의 name 과 동일하게 제한한다 —
 * 네임스페이스 구분자·셸 인자 오염을 막기 위함.
 */
export const mcpServerRenameSchema = z.object({
    name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/, {
        message: 'name 은 영숫자/언더스코어/하이픈만 허용',
    }),
});

/** MCP 서버 이름 변경 요청 TypeScript 타입 */
export type McpServerRenameInput = z.infer<typeof mcpServerRenameSchema>;

/** MCP 도구 실행 요청 TypeScript 타입 */
export type McpToolExecuteInput = z.infer<typeof mcpToolExecuteSchema>;
/** MCP 서버 등록 요청 TypeScript 타입 */
export type McpServerCreateInput = z.infer<typeof mcpServerCreateSchema>;
/** MCP 서버 env 교체 요청 TypeScript 타입 */
export type McpServerEnvUpdateInput = z.infer<typeof mcpServerEnvUpdateSchema>;
/** MCP 서버 사용 여부 토글 TypeScript 타입 */
export type McpServerEnabledUpdateInput = z.infer<typeof mcpServerEnabledUpdateSchema>;
/** MCP 서버 자동 연결 토글 TypeScript 타입 */
export type McpServerAutoSpawnUpdateInput = z.infer<typeof mcpServerAutoSpawnUpdateSchema>;
