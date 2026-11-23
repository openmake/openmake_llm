/**
 * 스킬 매니페스트 `mcp_bundles` 안내.
 *
 * `mcp_bundles` 는 검증 후 skill_mcp_bundles 에 **저장만** 하고 MCP 서버를 띄우지 않는다
 * (읽는 코드 없음 — lifecycle-supervisor 도 보지 않는다). 업로드한 스킬이 임의 command·env 로
 * stdio 프로세스를 띄우면 MCP 카탈로그 검수·확장 권한 심사(§11)를 건너뛰게 되므로 실행하지 않는 것이
 * 의도다. MCP 서버는 MCP 카탈로그나 설치형 확장으로 설치한다.
 *
 * 선언을 거절하지 않는 이유: 이미 mcp_bundles 를 적은 매니페스트의 업로드를 깨지 않기 위해서다.
 * 대신 업로드 응답(compat_notes)에 실행되지 않는다는 것을 알린다.
 */
export function mcpBundlesNotice(bundles: ReadonlyArray<{ server_name: string }>): string | null {
    if (bundles.length === 0) return null;
    const names = bundles.map((b) => b.server_name).join(', ');
    return `mcp_bundles ${bundles.length}개(${names})는 기록만 되고 실행되지 않습니다 — ` +
        'MCP 서버는 MCP 카탈로그나 확장기능으로 설치하세요';
}
