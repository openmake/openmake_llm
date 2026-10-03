/**
 * 브라우저 도구 목적지 검사 — goto 주소가 사설망·메타데이터·루프백으로 해석되면 실행하지 않는다.
 *
 * 브라우저 컨테이너는 기본이 bridge 망이고 egress 프록시는 기본 꺼짐이다. 종전에는 주소 검사가 모델이 넘기는
 * 선택적 allowlist 뿐이라, 프록시가 꺼진 배포에서 브라우저가 호스트의 로컬 서비스·사내망에 닿는 경로가 열려 있었다.
 * 호스트 쪽 fetch 에 쓰는 SSRF 가드(security/ssrf-guard)를 같은 기준으로 적용한다(허용 예외도 그 가드의 설정을 따른다).
 *
 * 한계: 실행 전에 goto 주소만 본다. 페이지가 일으키는 리다이렉트·하위 요청은 컨테이너 안(러너·프록시)에서 막아야 한다.
 *
 * @module services/task-sandbox/browser-url-guard
 */
import { validateOutboundUrl } from '../../security/ssrf-guard';

interface BlockedBrowserUrl {
    /** actions 배열에서의 위치. */
    index: number;
    url: string;
    reason: string;
}

/** 검사하지 않는 주소 — 브라우저 내부 빈 페이지. */
const SKIP_URLS: ReadonlySet<string> = new Set(['about:blank']);

/** actions 중 type='goto' 의 url 을 검사해 막아야 할 것만 돌려준다. validate 는 통과면 resolve, 막으면 throw. */
export async function findBlockedBrowserUrls(
    actions: readonly unknown[],
    validate: (url: string) => Promise<unknown> = (url) => validateOutboundUrl(url),
): Promise<BlockedBrowserUrl[]> {
    const blocked: BlockedBrowserUrl[] = [];
    for (const [index, a] of actions.entries()) {
        if (!a || typeof a !== 'object') continue;
        const o = a as { type?: unknown; url?: unknown };
        if (o.type !== 'goto' || typeof o.url !== 'string' || SKIP_URLS.has(o.url.trim())) continue;
        try {
            await validate(o.url);
        } catch (e) {
            blocked.push({ index, url: o.url, reason: e instanceof Error ? e.message : String(e) });
        }
    }
    return blocked;
}
