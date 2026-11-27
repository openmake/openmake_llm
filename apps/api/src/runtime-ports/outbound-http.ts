/**
 * 외부 HTTP 요청 포트 — add-on 이 `security/ssrf-guard` 를 직접 import 하지 않고 SSRF 가드를 거쳐 밖으로 요청하는 문.
 * hop 마다 스킴·DNS·차단 IP 를 검증하고 IP 를 고정한다(DNS rebinding 방어). 언제·어디로 보낼지는 add-on 이 정한다.
 *
 * @module runtime-ports/outbound-http
 */
export { safeFetch } from '../security/ssrf-guard';
