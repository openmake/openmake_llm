/**
 * MCP 프로토콜 리비전 — 우리가 **서버로서** 응답할 수 있는 버전 목록.
 *
 * 배경: `mcp/server.ts` 는 initialize 응답에 `2024-11-05` 를 고정 문자열로 실었다
 * (2024년 리비전). 클라이언트가 요청한 버전을 보지 않으므로 최신 클라이언트가
 * 붙어도 항상 2년 전 리비전으로 협상됐다.
 *
 * 여기 실린 리비전은 전부 **legacy era**(평범한 `initialize` 핸드셰이크)이며
 * `tools/list`·`tools/call` 의 와이어 형태가 동일하다 — 우리 서버가 구현한 범위가
 * 그 셋뿐이라 리비전 간 차이가 없다. 2026-07-28(modern era)은 `server/discover`·
 * tasks·`_meta` 봉투를 요구하므로 **의도적으로 제외**한다(구현하지 않은 것을
 * 광고하지 않는다).
 *
 * 목록·기본값은 `@modelcontextprotocol/client` 의 `SUPPORTED_PROTOCOL_VERSIONS` /
 * `LATEST_PROTOCOL_VERSION`(2.0.0 기준) 과 같다.
 *
 * @module config/mcp-protocol
 */

/** 우리 서버가 수용하는 리비전 (최신 우선). */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
    '2024-10-07',
];

/** 클라이언트가 버전을 안 보내거나 모르는 버전을 요청할 때 응답할 리비전. */
export const MCP_DEFAULT_PROTOCOL_VERSION = MCP_SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * initialize 협상 — 클라이언트가 요청한 리비전을 수용 가능하면 그대로 돌려주고,
 * 아니면 우리가 지원하는 최신 리비전을 돌려준다(MCP 규약).
 */
export function negotiateProtocolVersion(requested: unknown): string {
    return typeof requested === 'string' && MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : MCP_DEFAULT_PROTOCOL_VERSION;
}
