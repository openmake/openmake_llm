/**
 * Artifact Store (P04) — 소유권 판정: 사용자 간 차단(T10)·소유권 미상 종전 파일 격리(T27)·삭제본 미반환·전달 티켓.
 */
jest.mock('../../config', () => ({ getConfig: () => ({ jwtSecret: 'test-secret' }) }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const rows = new Map<string, unknown>();
const inserted: unknown[] = [];
jest.mock('../../data/repositories/generated-artifacts-repo', () => ({
    GeneratedArtifactsRepository: class {
        async getByFileName(name: string) { if (name === 'db-down.png') throw new Error('db down'); return rows.get(name) ?? null; }
        async insert(input: Record<string, unknown>) { inserted.push(input); const row = { id: inserted.length, ...input, deletedAt: null }; rows.set(String(input.fileName), row); return row; }
    },
}));
const files = new Map<string, 'private' | 'legacy_public'>();
jest.mock('../../tools/generated-media', () => ({
    ...jest.requireActual('../../tools/generated-media'),
    locateGeneratedFile: (name: string) => (files.has(name) ? { absPath: `/abs/${name}`, storage: files.get(name) } : null),
    writeGeneratedFilePrivate: (name: string) => { files.set(name, 'private'); return { absPath: `/abs/${name}`, urlPath: `/generated/${name}` }; },
}));

import { issueDeliveryTicket, resolveArtifactForRead, saveGeneratedArtifact, sniffMime, verifyDeliveryTicket } from '../artifact-store';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

beforeEach(() => { rows.clear(); files.clear(); inserted.length = 0; });

describe('resolveArtifactForRead', () => {
    it('T10: 사용자 A 의 산출물을 B 가 조회하면 403, 본인·관리자는 통과', async () => {
        files.set('a.png', 'private'); rows.set('a.png', { fileName: 'a.png', ownerUserId: 'A', mime: 'image/png', deletedAt: null });
        expect(await resolveArtifactForRead('a.png', { userId: 'B' })).toMatchObject({ ok: false, status: 403, reason: 'forbidden' });
        expect(await resolveArtifactForRead('a.png', { userId: 'A' })).toMatchObject({ ok: true, reason: 'owner', absPath: '/abs/a.png', mime: 'image/png' });
        expect(await resolveArtifactForRead('a.png', { userId: 'X', isAdmin: true })).toMatchObject({ ok: true, reason: 'admin' });
        expect(await resolveArtifactForRead('a.png', {})).toMatchObject({ ok: false, status: 401, reason: 'auth_required' });
    });

    it('T27: 레코드 없는 종전 공개 파일은 삭제하지 않고 격리(403) — 없는 파일은 404', async () => {
        files.set('legacy.png', 'legacy_public');
        expect(await resolveArtifactForRead('legacy.png', { userId: 'A', isAdmin: true })).toMatchObject({ ok: false, status: 403, reason: 'isolated' });
        expect(await resolveArtifactForRead('nope.png', { userId: 'A' })).toMatchObject({ ok: false, status: 404, reason: 'not_found' });
        expect(files.has('legacy.png')).toBe(true);
    });

    it('삭제된 산출물은 파일이 남아 있어도 404, 레코드 조회 실패는 403(정책 없음으로 읽지 않는다)', async () => {
        files.set('gone.png', 'private'); rows.set('gone.png', { fileName: 'gone.png', ownerUserId: 'A', mime: 'image/png', deletedAt: new Date() });
        expect(await resolveArtifactForRead('gone.png', { userId: 'A' })).toMatchObject({ ok: false, status: 404, reason: 'deleted' });
        files.set('db-down.png', 'private');
        expect(await resolveArtifactForRead('db-down.png', { userId: 'A' })).toMatchObject({ ok: false, status: 403, reason: 'forbidden' });
    });

    it('전달 티켓 — 파일명 고정·만료·서명 검증, 다른 파일 티켓은 무효', async () => {
        files.set('t.png', 'private'); rows.set('t.png', { fileName: 't.png', ownerUserId: 'A', mime: 'image/png', deletedAt: null });
        const ticket = issueDeliveryTicket('t.png', 1_000_000);
        expect(verifyDeliveryTicket('t.png', ticket, 1_000_001)).toBe(true);
        expect(verifyDeliveryTicket('other.png', ticket, 1_000_001)).toBe(false);
        expect(verifyDeliveryTicket('t.png', ticket, 1_000_000 + 11 * 60 * 1000)).toBe(false);
        expect(verifyDeliveryTicket('t.png', `${ticket}x`, 1_000_001)).toBe(false);
        expect(await resolveArtifactForRead('t.png', { ticket: issueDeliveryTicket('t.png') })).toMatchObject({ ok: true, reason: 'ticket' });
    });

    it('게스트 생성물(소유자 NULL)은 신원이 없어 공개 — 명시된 유일한 예외', async () => {
        files.set('g.png', 'private'); rows.set('g.png', { fileName: 'g.png', ownerUserId: null, mime: 'image/png', deletedAt: null });
        expect(await resolveArtifactForRead('g.png', {})).toMatchObject({ ok: true, reason: 'guest_public' });
    });
});

describe('saveGeneratedArtifact', () => {
    it('레코드를 먼저 만들고 비공개 디렉토리에 쓰며, MIME 은 바이트로 확인한다', async () => {
        const ref = await saveGeneratedArtifact({ userId: 'A', sessionId: 's1', capability: 'image.generate' }, { kind: 'image', prefix: 'img', ext: 'png', bytes: PNG, mime: 'image/jpeg' });
        expect(ref.urlPath).toMatch(/^\/generated\/img-\d+-[0-9a-f]{8}\.png$/);
        expect(ref.mimeType).toBe('image/png');
        expect(inserted[0]).toMatchObject({ ownerUserId: 'A', sessionId: 's1', storage: 'private', capability: 'image.generate', mime: 'image/png', sizeBytes: PNG.length });
        expect(files.get(ref.fileName)).toBe('private');
    });

    it('능동 콘텐츠·빈 바이트는 거절', async () => {
        await expect(saveGeneratedArtifact({}, { kind: 'image', prefix: 'img', ext: 'html', bytes: Buffer.from('<script>'), mime: 'text/html' })).rejects.toThrow(/허용되지 않는/);
        await expect(saveGeneratedArtifact({}, { kind: 'image', prefix: 'img', ext: 'png', bytes: Buffer.alloc(0), mime: 'image/png' })).rejects.toThrow(/빈/);
        expect(sniffMime(Buffer.from('OggS....'))).toBe('audio/ogg');
    });
});
