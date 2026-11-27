/**
 * 조직 소유 확장 설치(P8, 212) — 권한 매트릭스·감사·원본 해석 순서(무DB: 저장소는 메모리 대역).
 *
 * 매트릭스: 플랫폼 admin · 조직 owner · 조직 admin · 조직 member · 다른 조직 admin · 활성 조직 없음
 *   × list · install · update · remove. 판정은 security/authorize 'org_extension' 한 곳이다.
 * 설치한 관리자가 아니어도 같은 조직 관리자면 업데이트·제거할 수 있고(설치자에게 개인 권한이 없다), 다른 조직에는 존재도 드러나지 않는다(404).
 */
import type { ResolvedExtensionSource } from '../../../agents/git-ingest/extension-source-resolver';
import type { OrgOwnedExtensionRow } from '../../../data/repositories/org-owned-extension-repository';

const store = new Map<string, OrgOwnedExtensionRow>();
let seq = 0;
jest.mock('../../../data/repositories/org-owned-extension-repository', () => ({
    ORG_OWNED_NAME_CONFLICT: 'ORG_OWNED_NAME_CONFLICT',
    OrgOwnedExtensionRepository: jest.fn().mockImplementation(() => ({
        insert: async (orgId: string, by: string, input: Record<string, unknown>) => {
            for (const r of store.values()) {
                if (r.owner_org_id === orgId && r.name === input.name && r.status === 'active') throw new Error(`ORG_OWNED_NAME_CONFLICT: ${input.name}`);
            }
            const row = {
                id: `ext-${++seq}`, user_id: null, owner_org_id: orgId, installed_by_user_id: by, visibility: 'organization', org_id: orgId,
                name: input.name, version: input.version, description: input.description, source_url: input.sourceUrl,
                source_ref: input.sourceRef, source_path: input.sourcePath, source_hash: input.sourceHash, tracking_ref: input.trackingRef,
                manifest: input.manifest, status: 'active',
            } as unknown as OrgOwnedExtensionRow;
            store.set(row.id, row);
            return row;
        },
        getById: async (id: string) => { const r = store.get(id); return r && r.status === 'active' ? r : null; },
        listForOrg: async (orgId: string) => [...store.values()].filter((r) => r.owner_org_id === orgId && r.status === 'active'),
        updateSource: async (id: string, orgId: string, input: Record<string, unknown>) => {
            const r = store.get(id);
            if (!r || r.owner_org_id !== orgId) return null;
            Object.assign(r, { version: input.version, source_ref: input.sourceRef });
            return r;
        },
        remove: async (id: string, orgId: string) => {
            const r = store.get(id);
            if (!r || r.owner_org_id !== orgId) return null;
            r.status = 'removed';
            return r;
        },
    })),
}));

import {
    installOrgOwnedExtension, listOrgOwnedExtensions, removeOrgOwnedExtension, updateOrgOwnedExtension,
    type OrgOwnedActor, type OrgOwnedDeps,
} from '../org-owned-install';
import type { OrgContext } from '../../org/membership-cache';

type Who = 'platformAdmin' | 'orgOwner' | 'orgAdmin' | 'orgMember' | 'otherOrgAdmin' | 'noOrg';
const ACTORS: Record<Who, { actor: OrgOwnedActor; org: OrgContext | null }> = {
    platformAdmin: { actor: { userId: 'pa', role: 'admin' }, org: { orgId: 'org-z', orgRole: 'member' } },
    orgOwner: { actor: { userId: 'oo', role: 'user' }, org: { orgId: 'org-a', orgRole: 'owner' } },
    orgAdmin: { actor: { userId: 'oa', role: 'user' }, org: { orgId: 'org-a', orgRole: 'admin' } },
    orgMember: { actor: { userId: 'om', role: 'user' }, org: { orgId: 'org-a', orgRole: 'member' } },
    otherOrgAdmin: { actor: { userId: 'xa', role: 'user' }, org: { orgId: 'org-b', orgRole: 'admin' } },
    noOrg: { actor: { userId: 'nn', role: 'user' }, org: null },
};

let sha = 'a'.repeat(40);
const resolved = (name = 'acme-pack'): ResolvedExtensionSource => ({
    sha,
    effectiveGitUrl: 'https://github.com/acme/pack',
    effectiveTrackingRef: 'main',
    candidate: { path: '.claude-plugin/plugin.json' },
    manifest: { name, version: sha.startsWith('a') ? '1.0.0' : '2.0.0', description: 'd', raw: { name } },
    warnings: [],
} as unknown as ResolvedExtensionSource);

const resolveSource = jest.fn(async (input: { gitUrl: string }) => resolved(input.gitUrl.endsWith('/other') ? 'acme-other' : 'acme-pack'));
const audit = jest.fn(async () => undefined);
function deps(who: Who): OrgOwnedDeps {
    return { pool: {} as never, resolveSource, activeOrg: async () => ACTORS[who].org, audit };
}

/** org-a 소유 행 하나를 org-a 관리자가 설치해 둔다 */
async function seed(): Promise<string> {
    const r = await installOrgOwnedExtension(deps('orgAdmin'), ACTORS.orgAdmin.actor, { gitUrl: 'https://github.com/acme/pack' });
    return (r as OrgOwnedExtensionRow).id;
}

async function outcome(p: Promise<unknown>): Promise<number> {
    try { await p; return 200; } catch (err) { return (err as { statusCode?: number }).statusCode ?? 500; }
}

beforeEach(() => {
    store.clear();
    sha = 'a'.repeat(40);
    jest.clearAllMocks();
});

describe('권한 매트릭스', () => {
    // 기대 상태: 200 허용 · 403 거절 · 404 다른 조직(존재 숨김) · 400 활성 조직 없음
    const MATRIX: Record<Who, { install: number; update: number; remove: number }> = {
        platformAdmin: { install: 200, update: 200, remove: 200 },
        orgOwner: { install: 200, update: 200, remove: 200 },
        orgAdmin: { install: 200, update: 200, remove: 200 },
        orgMember: { install: 403, update: 403, remove: 403 },
        otherOrgAdmin: { install: 200, update: 404, remove: 404 },
        noOrg: { install: 400, update: 404, remove: 404 },
    };

    for (const who of Object.keys(MATRIX) as Who[]) {
        it(`${who}: install ${MATRIX[who].install} · update ${MATRIX[who].update} · remove ${MATRIX[who].remove}`, async () => {
            const { actor } = ACTORS[who];
            // install 은 자기 활성 조직 소유로(다른 조직 admin 은 자기 조직 org-b 에 설치 — 허용)
            expect(await outcome(installOrgOwnedExtension(deps(who), actor, { gitUrl: 'https://github.com/acme/other' }))).toBe(MATRIX[who].install);
            const id = await seed();
            sha = 'b'.repeat(40);
            expect(await outcome(updateOrgOwnedExtension(deps(who), actor, id))).toBe(MATRIX[who].update);
            expect(await outcome(removeOrgOwnedExtension(deps(who), actor, id))).toBe(MATRIX[who].remove);
        });
    }

    it('권한이 없으면 원본 해석(네트워크) 전에 거절한다', async () => {
        await outcome(installOrgOwnedExtension(deps('orgMember'), ACTORS.orgMember.actor, { gitUrl: 'https://github.com/acme/pack' }));
        expect(resolveSource).not.toHaveBeenCalled();
    });

    it('목록: 같은 조직 멤버는 읽고, 다른 조직·조직 없음은 빈 목록', async () => {
        await seed();
        expect((await listOrgOwnedExtensions(deps('orgMember'), ACTORS.orgMember.actor)).map((r) => r.name)).toEqual(['acme-pack']);
        expect(await listOrgOwnedExtensions(deps('otherOrgAdmin'), ACTORS.otherOrgAdmin.actor)).toEqual([]);
        expect(await listOrgOwnedExtensions(deps('noOrg'), ACTORS.noOrg.actor)).toEqual([]);
    });
});

describe('설치·업데이트·제거', () => {
    it('설치자가 아닌 같은 조직 관리자가 업데이트·제거한다 — 감사 기록 3건', async () => {
        const id = await seed(); // 설치자 = orgAdmin(oa)
        sha = 'b'.repeat(40);
        const up = await updateOrgOwnedExtension(deps('orgOwner'), ACTORS.orgOwner.actor, id);
        expect(up).toMatchObject({ upToDate: false, previousRef: 'a'.repeat(40), previousVersion: '1.0.0' });
        expect(up.row.source_ref).toBe('b'.repeat(40));
        await removeOrgOwnedExtension(deps('orgOwner'), ACTORS.orgOwner.actor, id);
        expect(audit.mock.calls.map((c) => (c as unknown as [{ action: string; userId: string }])[0])).toEqual([
            expect.objectContaining({ action: 'extension.org_owned_installed', userId: 'oa' }),
            expect.objectContaining({ action: 'extension.org_owned_updated', userId: 'oo' }),
            expect.objectContaining({ action: 'extension.org_owned_removed', userId: 'oo' }),
        ]);
    });

    it('같은 커밋이면 upToDate — 갱신·감사 없음', async () => {
        const id = await seed();
        audit.mockClear();
        const up = await updateOrgOwnedExtension(deps('orgAdmin'), ACTORS.orgAdmin.actor, id);
        expect(up.upToDate).toBe(true);
        expect(audit).not.toHaveBeenCalled();
    });

    it('저장 행: user_id 없음·조직 공개·org_id = 소유 조직·고정 커밋', async () => {
        const id = await seed();
        const [row] = await listOrgOwnedExtensions(deps('orgAdmin'), ACTORS.orgAdmin.actor);
        expect(row).toMatchObject({ id, user_id: null, owner_org_id: 'org-a', org_id: 'org-a', visibility: 'organization', source_ref: 'a'.repeat(40), installed_by_user_id: 'oa' });
    });

    it('같은 조직 같은 이름은 409', async () => {
        await seed();
        expect(await outcome(installOrgOwnedExtension(deps('orgOwner'), ACTORS.orgOwner.actor, { gitUrl: 'https://github.com/acme/pack' }))).toBe(409);
    });

    it('원본 해석은 관리자 전용 원본을 열지 않는다(isAdmin:false) — 플랫폼 admin 이어도', async () => {
        await installOrgOwnedExtension(deps('platformAdmin'), ACTORS.platformAdmin.actor, { gitUrl: 'local://x' });
        expect(resolveSource).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false, gitUrl: 'local://x' }));
    });

    it('원본 해석 실패(비 AppError)는 400 ORG_OWNED_SOURCE_FAILED', async () => {
        resolveSource.mockRejectedValueOnce(new Error('FILE_NOT_FOUND'));
        await expect(installOrgOwnedExtension(deps('orgAdmin'), ACTORS.orgAdmin.actor, { gitUrl: 'https://github.com/acme/pack' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'ORG_OWNED_SOURCE_FAILED' });
    });
});
