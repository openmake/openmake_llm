import { normalizeServerAddress, resolveEndpoints, discoverEndpoints, isPlainRemoteHttp } from '../endpoints';

describe('normalizeServerAddress', () => {
    it('주소 끝의 / 와 경로를 떼고, http(s) 가 아니면 받지 않는다', () => {
        expect(normalizeServerAddress(' https://chat.example.co.kr/ ')).toBe('https://chat.example.co.kr');
        expect(normalizeServerAddress('http://server:3010/chat?x=1')).toBe('http://server:3010');
        expect(normalizeServerAddress('chat.example.co.kr')).toBeNull();
        expect(normalizeServerAddress('ftp://x')).toBeNull();
        expect(normalizeServerAddress('')).toBeNull();
    });
});

describe('resolveEndpoints — 사용자가 넣은 주소 하나에서 연결 주소와 웹 주소를 정한다', () => {
    const ports = { apiPort: 52418, webPort: 3010 };

    it('웹 포트로 들어온 주소 — 웹은 그대로, 연결은 같은 호스트의 API 포트', () => {
        expect(resolveEndpoints('http://server:3010', ports)).toEqual({ bridgeUrl: 'http://server:52418', webUrl: 'http://server:3010', discovered: true });
    });

    it('API 포트로 들어온 주소 — 연결은 그대로, 웹은 같은 호스트의 웹 포트', () => {
        expect(resolveEndpoints('http://server:52418', ports)).toEqual({ bridgeUrl: 'http://server:52418', webUrl: 'http://server:3010', discovered: true });
    });

    it('둘 다 아닌 포트(앞단 프록시) — 넣은 주소를 그대로 쓴다', () => {
        expect(resolveEndpoints('https://chat.example.co.kr', ports)).toEqual({ bridgeUrl: 'https://chat.example.co.kr', webUrl: 'https://chat.example.co.kr', discovered: true });
        expect(resolveEndpoints('http://intranet:8080', ports)).toEqual({ bridgeUrl: 'http://intranet:8080', webUrl: 'http://intranet:8080', discovered: true });
    });

    it('포트를 생략한 주소는 그 방식의 기본 포트로 본다(http 80 · https 443)', () => {
        expect(resolveEndpoints('http://server', { apiPort: 52418, webPort: 80 })).toEqual({ bridgeUrl: 'http://server:52418', webUrl: 'http://server', discovered: true });
    });

    it('API 와 웹이 같은 포트면 넣은 주소 그대로', () => {
        expect(resolveEndpoints('http://server:8000', { apiPort: 8000, webPort: 8000 }).bridgeUrl).toBe('http://server:8000');
    });

    it('IPv6 호스트도 대괄호를 유지한다', () => {
        expect(resolveEndpoints('http://[::1]:3010', ports).bridgeUrl).toBe('http://[::1]:52418');
    });

    it('서버가 포트를 알려주지 않으면(구버전·이상한 값) 넣은 주소를 그대로 쓰고 discovered=false', () => {
        for (const cfg of [null, undefined, {}, { apiPort: 'x', webPort: 3010 }, { apiPort: 0, webPort: 70000 }]) {
            expect(resolveEndpoints('http://server:3010', cfg)).toEqual({ bridgeUrl: 'http://server:3010', webUrl: 'http://server:3010', discovered: false });
        }
    });
});

describe('discoverEndpoints', () => {
    const ok = (data: unknown) => async () => ({ ok: true, json: async () => ({ success: true, data }) });

    it('넣은 주소의 /api/desktop/config 를 묻는다', async () => {
        const seen: string[] = [];
        const fetchImpl = async (url: string) => { seen.push(url); return ok({ apiPort: 52418, webPort: 3010 })(); };
        const r = await discoverEndpoints('http://server:3010/', fetchImpl);
        expect(seen).toEqual(['http://server:3010/api/desktop/config']);
        expect(r.bridgeUrl).toBe('http://server:52418');
    });

    it('조회가 실패하거나(404·연결 실패) 응답이 이상하면 넣은 주소를 그대로 쓴다', async () => {
        const fallback = { bridgeUrl: 'https://old.example.com', webUrl: 'https://old.example.com', discovered: false };
        expect(await discoverEndpoints('https://old.example.com', async () => ({ ok: false, json: async () => ({}) }))).toEqual(fallback);
        expect(await discoverEndpoints('https://old.example.com', async () => { throw new Error('ECONNREFUSED'); })).toEqual(fallback);
        expect(await discoverEndpoints('https://old.example.com', async () => ({ ok: true, json: async () => { throw new Error('not json'); } }))).toEqual(fallback);
    });

    it('주소가 잘못됐으면 던진다', async () => {
        await expect(discoverEndpoints('server:3010', ok({}))).rejects.toThrow();
    });
});

describe('isPlainRemoteHttp — 암호화 없이 이 PC 밖으로 나가는 주소인가', () => {
    it('https 와 이 PC(localhost·127.0.0.1·::1)는 아니다', () => {
        expect(isPlainRemoteHttp('https://chat.example.co.kr')).toBe(false);
        expect(isPlainRemoteHttp('http://localhost:52416')).toBe(false);
        expect(isPlainRemoteHttp('http://127.0.0.1:3000')).toBe(false);
        expect(isPlainRemoteHttp('http://[::1]:3000')).toBe(false);
    });
    it('그 밖의 http 는 그렇다', () => {
        expect(isPlainRemoteHttp('http://server:3010')).toBe(true);
        expect(isPlainRemoteHttp('http://10.0.0.5')).toBe(true);
    });
});
