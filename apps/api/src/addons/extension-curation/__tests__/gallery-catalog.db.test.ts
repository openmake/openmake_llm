/**
 * 큐레이션 add-on 갤러리 × Base 카탈로그 저장소 — 실 DB(TEST_DATABASE_URL 없으면 skip).
 * §8-2 이전 뒤에도 운영 규모(원본 20개)의 큐레이션 카탈로그가 갤러리에서 전부 읽히고(꺼진 원본 제외), 원본 접근 토큰은 응답에 없으며,
 * 공유 확장·공유 토글이 Base `user_extensions` 에 그대로 읽고 쓴다. 만든 행은 id 로만 지운다.
 */
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;
const pool = CONN ? new Pool({ connectionString: CONN, max: 3 }) : (null as unknown as Pool);
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => pool, getUnifiedDatabase: () => ({ getPool: () => pool }) }));
const mockUser = { id: '' };
jest.mock('../../../auth/middleware', () => ({
    requireAuth: (req: Request & { user?: object }, _res: Response, next: NextFunction) => {
        req.user = { id: mockUser.id, userId: mockUser.id, role: 'user' };
        next();
    },
}));
jest.mock('../../../services/org/membership-cache', () => ({ membershipsFor: async () => [], activeOrgFor: async () => null }));

import { createGalleryRouter, createVisibilityRouter } from '../gallery-routes';
import { extensionCatalogPort } from '../../../runtime-ports/extension-catalog';

const SOURCES = 20;

describeOrSkip('갤러리 × 카탈로그 원본 20개 (실 DB)', () => {
    const tag = randomUUID().slice(0, 8);
    const sourceIds = Array.from({ length: SOURCES }, (_, i) => `ext-cat-curation-${tag}-${i}`);
    const disabledId = `ext-cat-curation-${tag}-off`;
    const owner = `test-curation-owner-${tag}`;
    const viewer = `test-curation-viewer-${tag}`;
    const extId = `user-ext-curation-${tag}`;

    function app() {
        const a = express();
        a.use(express.json());
        a.use('/api/users/me/extensions/gallery', createGalleryRouter());
        a.use('/api/users/me/extensions/:id/visibility', createVisibilityRouter());
        return a;
    }

    beforeAll(async () => {
        for (const [i, id] of sourceIds.entries()) {
            await pool.query(
                `INSERT INTO extension_catalog_sources (id, url, name, description, plugins, credential_encrypted) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
                [id, `https://github.com/curation-${tag}/market-${i}`, `market-${i}`, `원본 ${i}`, JSON.stringify([{ name: `plugin-${i}`, installable: true }]), i === 0 ? 'enc:secret' : null],
            );
        }
        await pool.query(
            `INSERT INTO extension_catalog_sources (id, url, name, plugins, enabled) VALUES ($1, $2, 'off', '[]'::jsonb, false)`,
            [disabledId, `https://github.com/curation-${tag}/off`],
        );
        for (const u of [owner, viewer]) await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [u]);
        await pool.query(
            `INSERT INTO user_extensions (id, user_id, name, version, source_url, source_ref, source_path, source_hash, manifest, status, visibility)
             VALUES ($1, $2, 'shared-pack', '1.0.0', $3, 'a', '.claude-plugin/plugin.json', 'h', '{}'::jsonb, 'active', 'private')`,
            [extId, owner, `https://github.com/curation-${tag}/pack`],
        );
    });
    afterAll(async () => {
        await pool.query('DELETE FROM user_extensions WHERE id = $1', [extId]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[owner, viewer]]);
        await pool.query('DELETE FROM extension_catalog_sources WHERE id = ANY($1::text[])', [[...sourceIds, disabledId]]);
        await pool.end();
    });

    it('enabled 원본 20개가 갤러리 카탈로그에 전부 실리고, 꺼진 원본·토큰 암호문은 없다', async () => {
        mockUser.id = viewer;
        const res = await request(app()).get('/api/users/me/extensions/gallery');
        expect(res.status).toBe(200);
        const ours = (res.body.data.catalog as Array<Record<string, unknown>>).filter((c) => String(c.id).startsWith(`ext-cat-curation-${tag}-`));
        expect(ours.map((c) => c.id).sort()).toEqual([...sourceIds].sort());
        for (const c of ours) expect(Object.keys(c).sort()).toEqual(['description', 'id', 'last_synced_at', 'name', 'plugins', 'url']);
        expect(ours.find((c) => c.id === sourceIds[3])!.plugins).toEqual([{ name: 'plugin-3', installable: true }]);
    });

    it('Base 카탈로그 포트도 20개 원본을 읽는다(M1·M7 add-on 이 쓰는 문)', async () => {
        const views = await Promise.all(sourceIds.map((id) => extensionCatalogPort.getSource(id)));
        expect(views.every((v) => v !== null && v.enabled && v.plugins.length === 1)).toBe(true);
    });

    it('공유 토글 → 다른 사용자의 갤러리에 owned:false 로 보이고, 비공개로 되돌리면 사라진다', async () => {
        mockUser.id = owner;
        const shared = await request(app()).patch(`/api/users/me/extensions/${extId}/visibility`).send({ visibility: 'shared' });
        expect(shared.status).toBe(200);
        expect(shared.body.data.extension).toMatchObject({ id: extId, visibility: 'shared' });
        expect(shared.body.data.extension.user_id).toBeUndefined();
        mockUser.id = viewer;
        const seen = await request(app()).get('/api/users/me/extensions/gallery');
        expect(seen.body.data.extensions.find((e: { id: string }) => e.id === extId)).toMatchObject({ owned: false, name: 'shared-pack' });
        mockUser.id = viewer;
        expect((await request(app()).patch(`/api/users/me/extensions/${extId}/visibility`).send({ visibility: 'private' })).status).toBe(404);
        mockUser.id = owner;
        await request(app()).patch(`/api/users/me/extensions/${extId}/visibility`).send({ visibility: 'private' });
        mockUser.id = viewer;
        const gone = await request(app()).get('/api/users/me/extensions/gallery');
        expect(gone.body.data.extensions.find((e: { id: string }) => e.id === extId)).toBeUndefined();
    });
});
