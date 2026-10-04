/**
 * guard-proxy — 목적지를 검사하는 포워드 프록시(HTTPS CONNECT + 평문 HTTP).
 *
 * 두 곳에서 같은 파일을 쓴다(이미지 빌드 문맥이 달라 사본을 둔다 — 원본은 infra/egress-proxy, 사본은
 * infra/task-runtime, 테스트가 두 파일이 같은지 본다):
 *   - egress 프록시(proxy.mjs): 도메인 목록 + 허용 포트 + 풀린 주소 검사.
 *   - 브라우저 러너(browser-runner.mjs): 프록시가 꺼진 배포에서 컨테이너 안 루프백에 띄워 풀린 주소만 검사.
 *
 * 브라우저의 모든 연결(리다이렉트, 하위 요청, 웹소켓)이 프록시를 지나므로 페이지 단위 가로채기가 놓치는
 * 리다이렉트도 여기서 걸린다. 검사한 주소로 직접 연결하므로 검사와 연결 사이에 이름이 다른 주소로 바뀌어도 닿지 않는다.
 *
 * 막는 대역은 호스트 쪽 가드(apps/api/src/security/ssrf-guard.ts)와 맞춘다. 6to4·NAT64 는 내장 주소를 풀지 않고
 * 대역째 막는다.
 */
import net from 'node:net';
import http from 'node:http';
import dns from 'node:dns/promises';

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
    ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['0.0.0.0', 8], ['100.64.0.0', 10], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) BLOCKED.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
    ['::', 96], ['64:ff9b::', 96], ['2002::', 16], ['2001::', 32], ['2001:db8::', 32], ['100::', 64],
    ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) BLOCKED.addSubnet(addr, prefix, 'ipv6');

/** 사설·루프백·링크로컬·메타데이터 등 닿으면 안 되는 주소인가. 주소가 아니면 막는다. */
export function isBlockedAddress(address) {
    const family = net.isIP(address);
    if (family === 0) return true;
    // IPv4-mapped(::ffff:a.b.c.d)는 BlockList 가 IPv4 규칙으로 본다.
    return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * 허용 예외 목록 — 호스트의 SSRF_ALLOWED_HOSTS 와 같은 형식(쉼표 구분: 호스트 이름, IPv4, IPv4 대역, 앞 둘에 `:포트`).
 * 포트를 붙이면 그 포트만, 생략하면 모든 포트.
 */
export function parseAllowedHosts(raw) {
    const entries = [];
    for (const part of String(raw ?? '').split(',')) {
        const token = part.trim();
        if (!token) continue;
        if (token.includes('/')) {
            const [network, prefix] = token.split('/');
            if (net.isIP(network) !== 4 || !/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) continue;
            const list = new net.BlockList();
            list.addSubnet(network, Number(prefix), 'ipv4');
            entries.push({ kind: 'cidr', list });
            continue;
        }
        const parts = token.split(':');
        const hasPort = parts.length === 2 && /^\d{1,5}$/.test(parts[1]);
        const host = hasPort ? parts[0] : token;
        entries.push({ kind: net.isIP(host) === 4 ? 'ipv4' : 'hostname', value: host.toLowerCase(), port: hasPort ? Number(parts[1]) : null });
    }
    return entries;
}

function isExempt(entries, host, address, port) {
    return entries.some((e) => {
        if (e.kind === 'cidr') return net.isIP(address) === 4 && e.list.check(address, 'ipv4');
        if (e.port !== null && e.port !== port) return false;
        return e.kind === 'hostname' ? host === e.value : (address === e.value || host === e.value);
    });
}

/**
 * 목적지 검사. 통과면 { ok: true, address }(연결할 주소), 막으면 { ok: false, code, reason }.
 *   opts.domains — 허용 도메인 목록(하위 도메인 포함). 없으면 도메인 제한 없음, 빈 배열이면 전부 거절.
 *   opts.ports   — 허용 포트 목록. 없으면 포트 제한 없음.
 *   opts.exempt  — parseAllowedHosts 결과. 막는 대역이라도 통과시킬 것.
 *   opts.lookup  — (host) => [{ address }] (기본: 시스템 DNS, 모든 주소).
 */
export async function checkDestination(rawHost, port, opts = {}) {
    const host = String(rawHost ?? '').toLowerCase().replace(/^\[|\]$/g, '');
    const exempt = opts.exempt ?? [];
    if (!host) return { ok: false, code: 'domain', reason: '호스트가 비어 있습니다' };
    if (opts.domains && !opts.domains.some((d) => host === d || host.endsWith('.' + d))) {
        return { ok: false, code: 'domain', reason: `허용 도메인 목록에 없는 호스트입니다: ${host}` };
    }
    if (opts.ports && !opts.ports.includes(port)) {
        return { ok: false, code: 'port', reason: `허용되지 않은 포트입니다: ${host}:${port}` };
    }
    let addresses;
    if (net.isIP(host)) {
        addresses = [host];
    } else {
        try {
            const lookup = opts.lookup ?? ((h) => dns.lookup(h, { all: true }));
            addresses = (await lookup(host)).map((a) => a.address);
        } catch (e) {
            return { ok: false, code: 'dns', reason: `주소를 찾지 못했습니다: ${host} (${e.code || e.message})` };
        }
        if (addresses.length === 0) return { ok: false, code: 'dns', reason: `주소를 찾지 못했습니다: ${host}` };
    }
    const bad = addresses.find((a) => isBlockedAddress(a) && !isExempt(exempt, host, a, port));
    if (bad) {
        return { ok: false, code: 'private', reason: `사설망·루프백·메타데이터 주소로는 연결하지 않습니다: ${host} → ${bad}` };
    }
    return { ok: true, address: addresses[0] };
}

/** `host:port` / `[v6]:port` 를 나눈다. */
function splitHostPort(target, defaultPort) {
    const m = String(target).match(/^(\[[^\]]+\]|[^:]*)(?::(\d+))?$/);
    return m ? { host: m[1], port: Number(m[2]) || defaultPort } : { host: '', port: defaultPort };
}

/** 프록시 구간에만 의미가 있는 요청 헤더 — 원 서버로 넘기지 않는다. */
const HOP_HEADERS = ['proxy-connection', 'proxy-authorization'];

/**
 * 목적지를 검사하는 포워드 프록시 서버를 만든다(listen 은 호출자가). opts 는 checkDestination 과 같고,
 * opts.onDeny({ host, port, code, reason }) 로 거절을 알린다.
 */
export function createGuardProxy(opts = {}) {
    const deny = (host, port, r) => { try { opts.onDeny?.({ host, port, code: r.code, reason: r.reason }); } catch { /* 알림 실패는 무시 */ } };

    // 평문 HTTP — 절대 주소로 온 요청을 검사한 주소로 전달한다.
    const server = http.createServer(async (req, res) => {
        let url;
        try { url = new URL(req.url); } catch { url = null; }
        if (!url || url.protocol !== 'http:') {
            res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('guard-proxy: 프록시 요청이 아닙니다');
            return;
        }
        const port = Number(url.port) || 80;
        const r = await checkDestination(url.hostname, port, opts);
        if (!r.ok) {
            deny(url.hostname, port, r);
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', connection: 'close', 'x-guard-proxy': 'denied' });
            res.end(`guard-proxy: ${r.reason}`);
            return;
        }
        const headers = { ...req.headers };
        for (const h of HOP_HEADERS) delete headers[h];
        const upstream = http.request({
            host: r.address, port, method: req.method, path: url.pathname + url.search, headers,
        }, (up) => {
            res.writeHead(up.statusCode ?? 502, up.headers);
            up.pipe(res);
        });
        upstream.on('error', () => {
            if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('guard-proxy: 원 서버에 연결하지 못했습니다');
        });
        req.pipe(upstream);
    });

    // HTTPS·웹소켓 — CONNECT host:port. 검사를 통과한 주소로만 터널을 연다.
    server.on('connect', async (req, clientSocket, head) => {
        clientSocket.on('error', () => { /* 아래에서 upstream 과 함께 정리 */ });
        const { host, port } = splitHostPort(req.url, 443);
        const r = await checkDestination(host, port, opts);
        if (!r.ok) {
            deny(host.replace(/^\[|\]$/g, ''), port, r);
            clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        const upstream = net.connect(port, r.address, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) upstream.write(head);
            upstream.pipe(clientSocket);
            clientSocket.pipe(upstream);
        });
        upstream.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => upstream.destroy());
        clientSocket.on('close', () => upstream.destroy());
    });

    server.on('clientError', (_e, socket) => { try { socket.destroy(); } catch { /* */ } });
    return server;
}
