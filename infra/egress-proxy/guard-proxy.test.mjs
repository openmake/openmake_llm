/**
 * guard-proxy 테스트 — `node --test infra/` 로 돈다(루트 npm test 에 포함).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isBlockedAddress, parseAllowedHosts, checkDestination, createGuardProxy } from './guard-proxy.mjs';

/** 이름을 정해진 주소로 풀어 주는 조회기. */
const lookupTo = (...addresses) => async () => addresses.map((address) => ({ address, family: net.isIP(address) }));

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** 프록시에 CONNECT 를 보내고 상태 줄과 본문을 돌려준다. */
function connectVia(proxyPort, target) {
    return new Promise((resolve, reject) => {
        const s = net.connect(proxyPort, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
        let buf = '';
        s.on('data', (b) => { buf += b.toString(); if (buf.includes('\r\n\r\n')) { s.destroy(); resolve(buf); } });
        s.on('error', reject);
        s.on('close', () => resolve(buf));
    });
}

/** 프록시를 거쳐 평문 HTTP GET. */
function getVia(proxyPort, url) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'GET', path: url, headers: { host: new URL(url).host } }, (res) => {
            let body = '';
            res.on('data', (b) => { body += b; });
            res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
    });
}

test('사설·루프백·링크로컬·메타데이터 주소를 막는다', () => {
    for (const ip of ['10.0.0.5', '172.16.3.1', '192.168.5.2', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
        '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1']) {
        assert.equal(isBlockedAddress(ip), true, ip);
    }
});

test('공인 주소는 막지 않는다', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
        assert.equal(isBlockedAddress(ip), false, ip);
    }
});

test('주소가 아닌 값은 막는다', () => {
    assert.equal(isBlockedAddress('not-an-ip'), true);
});

test('이름이 사설 주소로 풀리면 거절한다', async () => {
    const r = await checkDestination('intranet.example', 443, { lookup: lookupTo('10.1.2.3') });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'private');
});

test('풀린 주소 가운데 하나라도 사설이면 거절한다', async () => {
    const r = await checkDestination('mixed.example', 443, { lookup: lookupTo('93.184.216.34', '127.0.0.1') });
    assert.equal(r.ok, false);
});

test('공인 주소로 풀리면 그 주소를 돌려준다', async () => {
    const r = await checkDestination('example.com', 443, { lookup: lookupTo('93.184.216.34') });
    assert.deepEqual(r, { ok: true, address: '93.184.216.34' });
});

test('주소 리터럴은 조회 없이 검사한다', async () => {
    const lookup = async () => { throw new Error('조회하면 안 된다'); };
    assert.equal((await checkDestination('169.254.169.254', 80, { lookup })).ok, false);
    assert.equal((await checkDestination('[::1]', 80, { lookup })).ok, false);
    assert.equal((await checkDestination('93.184.216.34', 80, { lookup })).ok, true);
});

test('조회에 실패하면 거절한다', async () => {
    const r = await checkDestination('nxdomain.example', 443, { lookup: async () => { throw new Error('ENOTFOUND'); } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'dns');
});

test('도메인 목록이 있으면 목록 밖 호스트를 조회 전에 거절한다', async () => {
    const lookup = async () => { throw new Error('조회하면 안 된다'); };
    const r = await checkDestination('evil.example', 443, { domains: ['example.com'], lookup });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'domain');
});

test('도메인 목록은 하위 도메인을 받는다', async () => {
    const r = await checkDestination('api.example.com', 443, { domains: ['example.com'], lookup: lookupTo('93.184.216.34') });
    assert.equal(r.ok, true);
});

test('빈 도메인 목록은 전부 거절한다', async () => {
    const r = await checkDestination('example.com', 443, { domains: [], lookup: lookupTo('93.184.216.34') });
    assert.equal(r.code, 'domain');
});

test('허용 포트 밖이면 거절한다', async () => {
    const r = await checkDestination('example.com', 22, { ports: [80, 443], lookup: lookupTo('93.184.216.34') });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'port');
});

test('허용 예외 — 호스트 이름, 주소, 대역, 포트 지정', async () => {
    const exempt = parseAllowedHosts('rag.internal, 192.168.0.45, 10.1.0.0/16, 127.0.0.1:9100');
    assert.equal((await checkDestination('rag.internal', 443, { exempt, lookup: lookupTo('172.16.0.9') })).ok, true);
    assert.equal((await checkDestination('192.168.0.45', 8080, { exempt })).ok, true);
    assert.equal((await checkDestination('db.corp', 5432, { exempt, lookup: lookupTo('10.1.7.7') })).ok, true);
    assert.equal((await checkDestination('127.0.0.1', 9100, { exempt })).ok, true);
    assert.equal((await checkDestination('127.0.0.1', 5432, { exempt })).ok, false);
    assert.equal((await checkDestination('192.168.0.46', 80, { exempt })).ok, false);
});

test('허용 예외가 비어 있으면 아무것도 통과시키지 않는다', async () => {
    assert.deepEqual(parseAllowedHosts(''), []);
    assert.deepEqual(parseAllowedHosts(undefined), []);
});

test('프록시: 사설 주소로 가는 CONNECT 를 403 으로 거절하고 기록한다', async (t) => {
    const denied = [];
    const proxy = createGuardProxy({ onDeny: (d) => denied.push(d) });
    const port = await listen(proxy);
    t.after(() => proxy.close());
    const res = await connectVia(port, '169.254.169.254:443');
    assert.match(res, /^HTTP\/1\.1 403 /);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].host, '169.254.169.254');
    assert.equal(denied[0].code, 'private');
});

test('프록시: 평문 HTTP 요청이 사설 주소면 이유를 담은 403 을 준다', async (t) => {
    const proxy = createGuardProxy({});
    const port = await listen(proxy);
    t.after(() => proxy.close());
    const res = await getVia(port, 'http://192.168.5.2/admin');
    assert.equal(res.status, 403);
    assert.match(res.body, /192\.168\.5\.2/);
    // 러너가 '프록시가 막은 응답'과 원 서버의 403 을 구분하는 표지
    assert.equal(res.headers['x-guard-proxy'], 'denied');
});

test('프록시: 허용된 목적지는 풀린 주소로 연결해 평문 HTTP 를 전달한다', async (t) => {
    const upstream = http.createServer((req, res) => res.end(`host=${req.headers.host} path=${req.url}`));
    const upPort = await listen(upstream);
    // 이름은 루프백으로 풀리지만 예외에 넣어 통과시킨다 — 연결이 풀린 주소로 가는지 본다.
    const proxy = createGuardProxy({ exempt: parseAllowedHosts(`127.0.0.1:${upPort}`), lookup: lookupTo('127.0.0.1') });
    const port = await listen(proxy);
    t.after(() => { proxy.close(); upstream.close(); });
    const res = await getVia(port, `http://site.test:${upPort}/a?b=1`);
    assert.equal(res.status, 200);
    assert.equal(res.body, `host=site.test:${upPort} path=/a?b=1`);
});

test('프록시: 허용된 목적지의 CONNECT 는 터널을 연다', async (t) => {
    const upstream = net.createServer((s) => s.end('hello'));
    const upPort = await listen(upstream);
    const proxy = createGuardProxy({ exempt: parseAllowedHosts(`127.0.0.1:${upPort}`), lookup: lookupTo('127.0.0.1') });
    const port = await listen(proxy);
    t.after(() => { proxy.close(); upstream.close(); });
    const res = await connectVia(port, `site.test:${upPort}`);
    assert.match(res, /^HTTP\/1\.1 200 /);
});

test('프록시: 도메인 목록 밖 호스트의 CONNECT 를 거절한다', async (t) => {
    const proxy = createGuardProxy({ domains: ['example.com'], ports: [80, 443] });
    const port = await listen(proxy);
    t.after(() => proxy.close());
    assert.match(await connectVia(port, 'evil.example:443'), /^HTTP\/1\.1 403 /);
});

test('task-runtime 의 사본이 원본과 같다', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.equal(read('../task-runtime/guard-proxy.mjs'), read('./guard-proxy.mjs'));
});
