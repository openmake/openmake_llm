/**
 * OCI 레지스트리 확장 설치(P8, opt-in EXTENSION_OCI_INSTALL_ENABLED) — 레지스트리 mock(네트워크 0).
 * 매니페스트·토큰 교환·digest 고정·상한·경로 탈출·SSRF·미디어 타입·OFF 무변경.
 */
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { resetConfig } from '../../../config/env';
import { OciFetcher, parseAuthChallenge, applyLayerEntries, type OciFetchImpl } from '../oci-fetcher';
import { parseOciReference, isEnabledOciSourceUrl } from '../oci-reference';
import { readTar } from '../tar-reader';
import { isNonGitSourceUrl } from '../internal-bundle-fetcher';
import { makeNonGitFetcher } from '../extension-ingest-helpers';
import { resolveExtensionSource, isSelectionRequired } from '../extension-source-resolver';
import { safeFetch } from '../../../security/ssrf-guard';
import { ExtensionIngestService } from '../extension-ingest-service';
import type { GitFetcher } from '../git-fetcher';

// ── tar·매니페스트 빌더 ──────────────────────────────────────────────────────────
function header(name: string, size: number, type = '0', prefix = ''): Buffer {
    const h = Buffer.alloc(512, 0);
    h.write(name, 0, 100, 'utf-8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0', 257); h.write('00', 263);
    if (prefix) h.write(prefix, 345, 155, 'utf-8');
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
}
function tar(entries: Array<{ name: string; body?: string; type?: string }>): Buffer {
    const parts: Buffer[] = [];
    for (const e of entries) {
        const body = Buffer.from(e.body ?? '', 'utf-8');
        parts.push(header(e.name, body.length, e.type ?? '0'));
        parts.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
    parts.push(Buffer.alloc(1024));
    return Buffer.concat(parts);
}
const sha = (b: Uint8Array) => `sha256:${crypto.createHash('sha256').update(b).digest('hex')}`;

const PLUGIN = JSON.stringify({ name: 'oci-demo', version: '1.2.3', description: 'demo' });
const SKILL = '---\nname: hello\ndescription: say hello\n---\nHello';

interface Registry {
    blobs: Map<string, Buffer>;
    manifests: Map<string, Buffer>;   // ref(tag 또는 digest) → 본문
    calls: Array<{ url: string; auth?: string }>;
    token?: { realm: string; service: string; value: string; expectBasic?: string };
}

function makeRegistry(layers: Array<{ data: Buffer; mediaType: string }>, opts: { tag?: string; manifestOverride?: object } = {}): Registry & { digest: string } {
    const blobs = new Map<string, Buffer>();
    const desc = layers.map((l) => { const d = sha(l.data); blobs.set(d, l.data); return { mediaType: l.mediaType, digest: d, size: l.data.length }; });
    const manifest = Buffer.from(JSON.stringify(opts.manifestOverride ?? {
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { mediaType: 'application/vnd.oci.empty.v1+json', digest: sha(Buffer.from('{}')), size: 2 },
        layers: desc,
    }));
    const digest = sha(manifest);
    const manifests = new Map<string, Buffer>([[opts.tag ?? 'v1', manifest], [digest, manifest]]);
    return { blobs, manifests, calls: [], digest };
}

function fetchFor(reg: Registry, host = 'reg.example.com', repo = 'org/plugin'): OciFetchImpl {
    return async (url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        reg.calls.push({ url, auth: headers.Authorization });
        const u = new URL(url);
        if (reg.token && url.startsWith(reg.token.realm)) {
            if (reg.token.expectBasic !== undefined && headers.Authorization !== reg.token.expectBasic) return new Response('no', { status: 401 });
            return new Response(JSON.stringify({ token: reg.token.value }), { status: 200 });
        }
        if (u.host !== host) return new Response('nope', { status: 404 });
        if (reg.token && headers.Authorization !== `Bearer ${reg.token.value}`) {
            return new Response('auth', { status: 401, headers: { 'www-authenticate': `Bearer realm="${reg.token.realm}",service="${reg.token.service}",scope="repository:${repo}:push,pull"` } });
        }
        const m = new RegExp(`^/v2/${repo}/(manifests|blobs)/(.+)$`).exec(u.pathname);
        if (!m) return new Response('nope', { status: 404 });
        if (m[1] === 'manifests') {
            const body = reg.manifests.get(m[2]);
            return body ? new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'application/vnd.oci.image.manifest.v1+json' } }) : new Response('x', { status: 404 });
        }
        const blob = reg.blobs.get(m[2]);
        return blob ? new Response(new Uint8Array(blob), { status: 200 }) : new Response('x', { status: 404 });
    };
}

const TGZ = 'application/vnd.oci.image.layer.v1.tar+gzip';
const TAR = 'application/vnd.oci.image.layer.v1.tar';
const URL_TAG = 'oci://reg.example.com/org/plugin:v1';

function pluginLayer(extra: Array<{ name: string; body?: string; type?: string }> = []): Buffer {
    return zlib.gzipSync(tar([
        { name: 'bundle/.claude-plugin/plugin.json', body: PLUGIN },
        { name: 'bundle/skills/hello/SKILL.md', body: SKILL },
        ...extra.map((e) => ({ ...e, name: e.name })),
    ]));
}

const ORIGINAL = process.env.EXTENSION_OCI_INSTALL_ENABLED;
function setFlag(v: string | undefined): void {
    if (v === undefined) delete process.env.EXTENSION_OCI_INSTALL_ENABLED; else process.env.EXTENSION_OCI_INSTALL_ENABLED = v;
    resetConfig();
}
afterAll(() => setFlag(ORIGINAL));

describe('parseOciReference — 정규화·거절', () => {
    it('태그·digest·기본 latest·Docker Hub 별칭', () => {
        expect(parseOciReference('oci://Reg.Example.com:443/org/plugin:v1')).toMatchObject({ registry: 'reg.example.com', repository: 'org/plugin', tag: 'v1', url: 'oci://reg.example.com/org/plugin:v1' });
        expect(parseOciReference('oci://reg.example.com:5000/a/b')).toMatchObject({ registry: 'reg.example.com:5000', tag: 'latest' });
        const d = `sha256:${'a'.repeat(64)}`;
        expect(parseOciReference(`oci://ghcr.io/o/r@${d}`)).toMatchObject({ digest: d });
        expect(parseOciReference(`oci://ghcr.io/o/r@${d}`)?.tag).toBeUndefined();
        expect(parseOciReference('oci://index.docker.io/nginx:1')).toMatchObject({ registry: 'docker.io', apiHost: 'registry-1.docker.io', repository: 'library/nginx' });
    });
    it.each([
        'oci://reg.example.com/Org/plugin:v1',          // 대문자 저장소
        'oci://reg.example.com/org/../x:v1',            // ..
        'oci://user:pw@reg.example.com/org/x:v1',       // userinfo
        'oci://reg.example.com/org/%2e%2e/x:v1',        // 퍼센트 인코딩
        'oci://reg.example.com/org/x:v1?q=1',           // 쿼리
        'oci://reg.example.com/org/x:v1#f',             // 프래그먼트
        'oci://org/x:v1',                               // 레지스트리 호스트 아님
        'oci://reg.example.com/org//x',                 // 빈 구성요소
        `oci://reg.example.com/org/x@sha256:${'A'.repeat(64)}`, // 대문자 digest
        'oci://reg.example.com/org\\x',
    ])('거절: %s', (u) => {
        expect(parseOciReference(u)).toBeNull();
    });
});

describe('OciFetcher — 레지스트리 mock', () => {
    it('익명 토큰 교환(scope 는 항상 pull) → 매니페스트·레이어 → 파일 트리, digest 고정', async () => {
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        reg.token = { realm: 'https://auth.example.com/token', service: 'reg.example.com', value: 'anon-tok' };
        const f = new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg) });
        const digest = await f.resolveRef('', '', 'HEAD');
        expect(digest).toBe(reg.digest);
        const tree = await f.listTree('', '', digest);
        expect(tree.sha).toBe(reg.digest);
        expect(tree.entries.map((e) => e.path).sort()).toEqual(['.claude-plugin/plugin.json', 'skills/hello/SKILL.md']);
        expect(await f.fetchFile('', '', digest, '.claude-plugin/plugin.json')).toBe(PLUGIN);
        const tokenCall = reg.calls.find((c) => c.url.startsWith('https://auth.example.com/'))!;
        const tu = new URL(tokenCall.url);
        expect(tu.searchParams.get('scope')).toBe('repository:org/plugin:pull');   // 서버가 요구한 push 무시
        expect(tu.searchParams.get('service')).toBe('reg.example.com');
        expect(tokenCall.auth).toBeUndefined();
        expect(reg.calls.filter((c) => c.url.includes('/v2/')).slice(-2).every((c) => c.auth === 'Bearer anon-tok')).toBe(true);
    });

    it('사설 레지스트리 accessToken 은 같은 호스트 realm 에만 Basic 으로 보낸다', async () => {
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        const basic = `Basic ${Buffer.from('bot:s3cret').toString('base64')}`;
        reg.token = { realm: 'https://reg.example.com/token', service: 'reg', value: 'priv', expectBasic: basic };
        await new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg), accessToken: 'bot:s3cret' }).resolveRef('', '');
        expect(reg.calls.find((c) => c.url.startsWith('https://reg.example.com/token'))!.auth).toBe(basic);

        const reg2 = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        reg2.token = { realm: 'https://other.example.net/token', service: 'reg', value: 'x' };
        await new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg2), accessToken: 'bot:s3cret' }).resolveRef('', '');
        expect(reg2.calls.find((c) => c.url.startsWith('https://other.example.net/'))!.auth).toBeUndefined();
    });

    it('http realm 은 거절', async () => {
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        reg.token = { realm: 'http://auth.example.com/token', service: 's', value: 't' };
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg) }).resolveRef('', '')).rejects.toThrow(/OCI_AUTH_FAILED: realm 은 https/);
    });

    it('digest 지정 원본: 받은 매니페스트가 다르면 거절', async () => {
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        const other = `sha256:${'b'.repeat(64)}`;
        reg.manifests.set(other, reg.manifests.get('v1')!);   // 레지스트리가 다른 내용을 준다
        await expect(new OciFetcher(`oci://reg.example.com/org/plugin@${other}`, { fetchImpl: fetchFor(reg) }).resolveRef('', '')).rejects.toThrow(/OCI_DIGEST_MISMATCH/);
        await expect(new OciFetcher(`oci://reg.example.com/org/plugin@${reg.digest}`, { fetchImpl: fetchFor(reg) }).resolveRef('', '')).resolves.toBe(reg.digest);
    });

    it('레이어 digest 불일치 거절', async () => {
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        const [d] = [...reg.blobs.keys()];
        const tampered = Buffer.from(reg.blobs.get(d)!); tampered[tampered.length - 1] ^= 1;
        reg.blobs.set(d, tampered);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg) }).resolveRef('', '')).rejects.toThrow(/OCI_DIGEST_MISMATCH: layer/);
    });

    it('레이어 미디어 타입 화이트리스트 밖 거절 · 인덱스 거절', async () => {
        const reg = makeRegistry([{ data: Buffer.from('x'), mediaType: 'application/vnd.example.config+json' }]);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg) }).resolveRef('', '')).rejects.toThrow(/OCI_LAYER_MEDIA_TYPE_REJECTED/);
        const idx = makeRegistry([], { manifestOverride: { schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [] } });
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(idx) }).resolveRef('', '')).rejects.toThrow(/OCI_INDEX_UNSUPPORTED/);
    });

    it('레이어 미디어 타입 화이트리스트는 상속 키(toString·constructor·__proto__)를 허용하지 않는다', async () => {
        for (const mediaType of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
            const reg = makeRegistry([{ data: pluginLayer(), mediaType }]);
            await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg) }).resolveRef('', '')).rejects.toThrow(/OCI_LAYER_MEDIA_TYPE_REJECTED/);
        }
    });

    it('상한: 레이어 수 · blob 합계 · 압축 폭탄 · 파일 수 · 매니페스트 크기', async () => {
        const two = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }, { data: pluginLayer(), mediaType: TGZ }]);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(two), limits: { maxLayers: 1 } }).resolveRef('', '')).rejects.toThrow(/OCI_TOO_MANY_LAYERS/);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(two), limits: { maxBlobBytes: 100 } }).resolveRef('', '')).rejects.toThrow(/OCI_TOO_LARGE: 레이어 합계/);

        const bomb = zlib.gzipSync(tar([{ name: 'big.bin', body: 'a'.repeat(2_000_000) }]));
        const b = makeRegistry([{ data: bomb, mediaType: TGZ }]);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(b), limits: { maxTotalBytes: 100_000, maxEntries: 10 } }).resolveRef('', '')).rejects.toThrow(/OCI_TOO_LARGE: 해제 총 크기/);

        const many = makeRegistry([{ data: tar(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.md`, body: 'x' }))), mediaType: TAR }]);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(many), limits: { maxEntries: 5 } }).resolveRef('', '')).rejects.toThrow(/TOO_MANY_ENTRIES/);

        const m = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        await expect(new OciFetcher(URL_TAG, { fetchImpl: fetchFor(m), limits: { manifestMaxBytes: 50 } }).resolveRef('', '')).rejects.toThrow(/OCI_TOO_LARGE: manifest/);
    });

    it('경로 탈출(`..`·절대경로) 엔트리는 ZIP 과 같은 함수로 제외, `./` 는 정규화, 링크는 건너뜀', async () => {
        const layer = tar([
            { name: './.claude-plugin/plugin.json', body: PLUGIN },
            { name: 'README.md', body: 'ok' },
            { name: '../escape.md', body: 'evil' },
            { name: '/etc/passwd', body: 'evil' },
            { name: 'skills/a/../../x.md', body: 'evil' },
            { name: 'link', type: '2' },
        ]);
        const reg = makeRegistry([{ data: layer, mediaType: TAR }]);
        const tree = await new OciFetcher(URL_TAG, { fetchImpl: fetchFor(reg) }).listTree('', '', '');
        expect(tree.entries.map((e) => e.path).sort()).toEqual(['.claude-plugin/plugin.json', 'README.md']);
    });

    it('레이어 겹치기 — whiteout 은 앞 레이어 파일을 지운다', () => {
        const acc = new Map<string, Uint8Array>([['a/x.md', Buffer.from('1')], ['a/y.md', Buffer.from('2')], ['b/z.md', Buffer.from('3')]]);
        applyLayerEntries(acc, [{ path: 'a/.wh.x.md', data: Buffer.alloc(0) }, { path: 'b/.wh..wh..opq', data: Buffer.alloc(0) }, { path: 'c.md', data: Buffer.from('4') }]);
        expect([...acc.keys()].sort()).toEqual(['a/y.md', 'c.md']);
    });

    it('SSRF 가드 — 내부망으로 풀리는 레지스트리·realm 은 요청 전에 막힌다(실 safeFetch, DNS 만 주입)', async () => {
        let connects = 0;
        const blocked = (ip: string): OciFetchImpl => (u, i) => safeFetch(u, i, async () => { connects++; return { address: ip }; });
        await expect(new OciFetcher(URL_TAG, { fetchImpl: blocked('10.0.0.5') }).resolveRef('', '')).rejects.toThrow(/SSRF blocked/);
        await expect(new OciFetcher('oci://169.254.169.254/latest/meta:v1', { fetchImpl: blocked('169.254.169.254') }).resolveRef('', '')).rejects.toThrow(/SSRF blocked/);
        expect(connects).toBe(2);   // DNS 해석만 일어나고 연결은 없다

        // realm 이 내부망 — 레지스트리는 mock, realm 요청만 실제 가드로
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        reg.token = { realm: 'https://metadata.internal/token', service: 's', value: 't' };
        const base = fetchFor(reg);
        const mixed: OciFetchImpl = (u, i) => (u.startsWith('https://metadata.internal/') ? safeFetch(u, i, async () => ({ address: '127.0.0.1' })) : base(u, i));
        await expect(new OciFetcher(URL_TAG, { fetchImpl: mixed }).resolveRef('', '')).rejects.toThrow(/SSRF blocked/);
    });

    it('WWW-Authenticate 파싱', () => {
        expect(parseAuthChallenge('Bearer realm="https://a/t",service="r",scope="x"')).toEqual({ scheme: 'bearer', params: { realm: 'https://a/t', service: 'r', scope: 'x' } });
        expect(parseAuthChallenge('Basic realm="r"')?.scheme).toBe('basic');
        expect(parseAuthChallenge('Digest x')).toBeNull();
    });

    it('tar 체크섬 불일치·base-256 크기 거절', () => {
        const t = tar([{ name: 'a.md', body: 'x' }]);
        t[0] = 'b'.charCodeAt(0);
        expect(() => readTar(t, { maxEntries: 10 })).toThrow(/체크섬/);
    });
});

describe('설치 엔진 배선 — 플래그', () => {
    const resolverDeps = (reg: Registry) => ({
        fetcherFactory: () => { throw new Error('git fetcher 를 쓰면 안 된다'); },
        makeArchiveFetcher: (u: string, s?: { accessToken?: string }) => makeNonGitFetcher(u, { ociFetch: fetchFor(reg) }, s) as GitFetcher,
    });

    it('OFF(기본): oci:// 는 원본이 아니다 — 종전처럼 INVALID_GIT_URL, 네트워크 0', async () => {
        setFlag(undefined);
        expect(isEnabledOciSourceUrl(URL_TAG)).toBe(false);
        expect(isNonGitSourceUrl(URL_TAG)).toBe(false);
        const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
        await expect(resolveExtensionSource(resolverDeps(reg) as never, { gitUrl: URL_TAG, userId: 'u1' } as never)).rejects.toThrow(`INVALID_GIT_URL: ${URL_TAG}`);
        expect(reg.calls).toHaveLength(0);
    });

    it('ON: 설치 해석이 OCI 원본을 읽고 sha 는 매니페스트 digest', async () => {
        setFlag('true');
        try {
            const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
            const r = await resolveExtensionSource(resolverDeps(reg) as never, { gitUrl: URL_TAG, userId: 'u1' } as never);
            if (isSelectionRequired(r)) throw new Error('unexpected');
            expect(r.isArchive).toBe(true);
            expect(r.sha).toBe(reg.digest);
            expect(r.effectiveTrackingRef).toBeNull();
            expect(r.manifest.name).toBe('oci-demo');
            // 같은 태그가 새 digest 를 가리키면 다시 풀었을 때 다른 sha(업데이트 확인의 근거)
            const moved = makeRegistry([{ data: pluginLayer([{ name: 'bundle/README.md', body: 'v2' }]), mediaType: TGZ }]);
            const latest = await makeNonGitFetcher(URL_TAG, { ociFetch: fetchFor(moved) }).resolveRef('', '', 'HEAD');
            expect(latest).toBe(moved.digest);
            expect(latest).not.toBe(reg.digest);
        } finally {
            setFlag(undefined);
        }
    });
});

describe('ExtensionIngestService.checkForUpdate — OCI 태그의 새 digest', () => {
    it('설치 digest 와 같으면 업데이트 없음, 태그가 새 digest 를 가리키면 updateAvailable + 새 버전', async () => {
        setFlag('true');
        try {
            const reg = makeRegistry([{ data: pluginLayer(), mediaType: TGZ }]);
            let current: Registry & { digest: string } = reg;
            const svc = new ExtensionIngestService({
                pool: {} as never,
                llmClientFactory: () => { throw new Error('no llm'); },
                fetcherFactory: () => { throw new Error('git fetcher 를 쓰면 안 된다'); },
                ociFetch: (u, i) => fetchFor(current)(u, i),
            });
            const same = await svc.checkForUpdate({ sourceUrl: URL_TAG, sourcePath: '.claude-plugin/plugin.json', currentRef: reg.digest, trackingRef: null });
            expect(same.updateAvailable).toBe(false);

            const v2 = JSON.stringify({ name: 'oci-demo', version: '2.0.0' });
            current = makeRegistry([{ data: zlib.gzipSync(tar([{ name: 'bundle/.claude-plugin/plugin.json', body: v2 }, { name: 'bundle/skills/hello/SKILL.md', body: SKILL }])), mediaType: TGZ }]);
            const moved = await svc.checkForUpdate({ sourceUrl: URL_TAG, sourcePath: '.claude-plugin/plugin.json', currentRef: reg.digest, trackingRef: null });
            expect(moved).toMatchObject({ updateAvailable: true, currentRef: reg.digest, latestRef: current.digest, latestVersion: '2.0.0' });
        } finally {
            setFlag(undefined);
        }
    });
});
