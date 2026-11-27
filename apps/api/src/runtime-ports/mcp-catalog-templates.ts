/**
 * MCP 카탈로그 초안 포트 — 다른 add-on(외부 레지스트리 큐레이션 등)이 MCP 카탈로그 템플릿 **초안**을 만드는 문.
 *
 * 카탈로그 표는 MCP 런타임 add-on 이 소유한다. 그 add-on 이 부팅 때 작성기를 등록하고, 호출자는 이 포트만 부른다
 * (add-on 끼리 import 하지 않는다). 초안은 언제나 꺼진 상태(`is_enabled=false`)로 만들어진다 — 관리자가 MCP 카탈로그
 * 화면에서 검토하고 켠다. 등록이 없으면(MCP 런타임 꺼짐) `unavailable`.
 *
 * @module runtime-ports/mcp-catalog-templates
 */

/** 초안 입력 — 선언값만(실행·연결하지 않는다) */
export interface McpCatalogDraftInput {
    /** `mcp-` 로 시작하는 소문자·숫자·하이픈 */
    id: string;
    displayName: string;
    description?: string | null;
    transportType: 'stdio' | 'sse' | 'streamable-http';
    commandTemplate?: string | null;
    urlTemplate?: string | null;
    envSchema?: Record<string, unknown>;
}

export type McpCatalogDraftResult =
    | { status: 'created'; id: string }
    | { status: 'exists'; id: string }
    | { status: 'invalid'; message: string }
    | { status: 'unavailable' };

export type McpCatalogDraftWriter = (input: McpCatalogDraftInput) => Promise<McpCatalogDraftResult>;

let writer: McpCatalogDraftWriter | null = null;

/** 카탈로그를 소유한 add-on 이 부팅 때 등록한다. 해제 함수를 돌려준다(뒤에 등록한 것이 이긴다). */
export function registerMcpCatalogDraftWriter(w: McpCatalogDraftWriter): () => void {
    writer = w;
    return () => { if (writer === w) writer = null; };
}

/** 꺼진 초안을 만든다 — 작성기 없음이면 unavailable. 작성기 오류는 그대로 던진다(호출자가 500 으로 다룬다). */
export async function createMcpCatalogDraft(input: McpCatalogDraftInput): Promise<McpCatalogDraftResult> {
    if (!writer) return { status: 'unavailable' };
    return writer(input);
}

/** 테스트 전용 */
export function resetMcpCatalogDraftWriterForTest(): void {
    writer = null;
}
