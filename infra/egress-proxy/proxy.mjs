/**
 * Egress 포워드 프록시 — 브라우저 컨테이너의 네트워크 레벨 도메인 allowlist (Manus 하드닝).
 *
 * 브라우저 전용 task 컨테이너는 internal Docker 네트워크(인터넷 차단)에만 연결되고, 이 프록시를
 * 통해서만 외부로 나간다. 프록시는 HTTPS CONNECT 의 대상 호스트를 allowlist 와 대조해
 * 허용 도메인만 터널을 연다(네트워크 레벨 — 브라우저 page.route 앱-레벨 allowlist 위의 이중방어).
 *
 * EGRESS_ALLOWLIST=쉼표목록 (비면 전부 거부 = fail-safe). 하위도메인 매칭.
 * 포트 8888.
 */
import net from 'node:net';
import http from 'node:http';

const PORT = Number(process.env.EGRESS_PROXY_PORT) || 8888;
const ALLOW = (process.env.EGRESS_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function allowed(host) {
    if (!host) return false;
    const h = host.toLowerCase();
    // fail-safe: allowlist 비면 전부 거부.
    return ALLOW.some((d) => h === d || h.endsWith('.' + d));
}

function log(msg) { process.stdout.write(`[egress-proxy] ${msg}\n`); }

// 일반 HTTP 프록시 요청은 미지원(브라우저 HTTPS 는 CONNECT 사용) — 405.
const server = http.createServer((_req, res) => {
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('egress-proxy: HTTPS CONNECT only');
});

// HTTPS 터널 — CONNECT host:port. allowlist 통과 시에만 TCP 터널 연결.
server.on('connect', (req, clientSocket, head) => {
    const [host, portRaw] = String(req.url).split(':');
    const port = Number(portRaw) || 443;
    if (!allowed(host)) {
        log(`DENY ${host}:${port}`);
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        clientSocket.destroy();
        return;
    }
    const upstream = net.connect(port, host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
});

server.on('clientError', (_e, socket) => { try { socket.destroy(); } catch { /* */ } });
server.listen(PORT, () => log(`listening :${PORT} allowlist=[${ALLOW.join(',') || '(empty=deny-all)'}]`));
