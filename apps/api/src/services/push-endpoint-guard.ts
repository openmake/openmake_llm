/**
 * Web Push 구독 endpoint 아웃바운드 검증 (2026-09-02 보안 리뷰 L1)
 *
 * PushService 는 저장된 endpoint 로 서버측 POST(webPush.sendNotification) 를 보내므로
 * 등록 시점에 SSRF 가드를 통과시킨다 — 사설·loopback·link-local 대역이나 http 스킴은 거부.
 * 발송 경로는 web-push 라이브러리 내부 fetch 라 pinned fetch 를 끼울 수 없어 등록 시 검증이 유일한 관문이다.
 */
import { validateOutboundUrl, type DnsResolver } from '../security/ssrf-guard';
import { ValidationError } from '../utils/error-handler';

export async function assertPushEndpointAllowed(endpoint: string, resolver?: DnsResolver): Promise<void> {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new ValidationError('endpoint는 URL이어야 합니다');
    }
    if (url.protocol !== 'https:') {
        throw new ValidationError('endpoint는 https URL이어야 합니다');
    }
    try {
        await (resolver ? validateOutboundUrl(endpoint, resolver) : validateOutboundUrl(endpoint));
    } catch {
        throw new ValidationError('허용되지 않는 push endpoint 입니다');
    }
}
