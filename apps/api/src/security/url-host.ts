/**
 * 감사 기록용 URL host (#1476) — 감사에 URL 전체(경로·쿼리·계정)를 남기지 않으려고 host(포트 포함)만 꺼낸다.
 * MCP 서버 감사·외부 키 base_url·웹 스크래퍼 SSRF 감사가 따로 두던 같은 동작의 사본을 하나로 묶었다. 파싱 실패는 'invalid'.
 *
 * @module security/url-host
 */
export function auditUrlHost(url: unknown): string {
    try { return new URL(String(url)).host; } catch { return 'invalid'; }
}
