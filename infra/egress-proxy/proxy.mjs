/**
 * Egress 포워드 프록시 — 브라우저 컨테이너의 네트워크 레벨 도메인 allowlist (Manus 하드닝).
 *
 * 브라우저 전용 task 컨테이너는 internal Docker 네트워크(인터넷 차단)에만 연결되고, 이 프록시를
 * 통해서만 외부로 나간다. 프록시는 대상 호스트를 allowlist 와 대조하고, 허용 포트와 풀린 주소까지 검사한 뒤
 * 검사한 주소로 연결한다(네트워크 레벨 — 브라우저 page.route 앱-레벨 allowlist 위의 이중방어). 허용 도메인이
 * 사설 주소로 풀리거나 리다이렉트로 내부 포트에 닿는 것을 막는다. 검사 본체는 guard-proxy.mjs.
 *
 * EGRESS_ALLOWLIST=쉼표목록 (비면 전부 거부 = fail-safe). 하위도메인 매칭.
 * EGRESS_ALLOWED_PORTS=쉼표목록 (기본 80,443).
 * 포트 8888.
 */
import { createGuardProxy } from './guard-proxy.mjs';

const PORT = Number(process.env.EGRESS_PROXY_PORT) || 8888;
const ALLOW = (process.env.EGRESS_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const PORTS = (process.env.EGRESS_ALLOWED_PORTS || '80,443')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);

function log(msg) { process.stdout.write(`[egress-proxy] ${msg}\n`); }

const server = createGuardProxy({
    domains: ALLOW,
    ports: PORTS,
    onDeny: (d) => log(`DENY ${d.host}:${d.port} (${d.code})`),
});
server.listen(PORT, () => log(`listening :${PORT} allowlist=[${ALLOW.join(',') || '(empty=deny-all)'}] ports=[${PORTS.join(',')}]`));
