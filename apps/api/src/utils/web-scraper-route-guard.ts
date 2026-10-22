/**
 * Playwright 요청 가드 — 스크래퍼 브라우저의 모든 요청(문서·하위 리소스·리다이렉트)을 SSRF 가드로 검사한다(W3 S6).
 *
 * 하위 리소스가 많아도 DNS 조회가 폭증하지 않도록 같은 origin(스킴·호스트·포트)은 한 번만 검증하고 결과를 재사용한다.
 *
 * @module utils/web-scraper-route-guard
 */

/** validate 가 통과하면 true, 던지면 false 를 돌려주는 가드. 같은 origin 은 첫 검증 결과를 재사용한다. */
export function createRouteGuard(validate: (url: string) => Promise<unknown>): (url: string) => Promise<boolean> {
    const byOrigin = new Map<string, Promise<boolean>>();
    return (url: string) => {
        let origin: string;
        try {
            origin = new URL(url).origin;
        } catch {
            return Promise.resolve(false);
        }
        let verdict = byOrigin.get(origin);
        if (!verdict) {
            verdict = validate(url).then(() => true, () => false);
            byOrigin.set(origin, verdict);
        }
        return verdict;
    };
}
