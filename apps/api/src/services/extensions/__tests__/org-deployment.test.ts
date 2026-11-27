/**
 * 조직 확장 배포 모드 조정·제거 판정(§8-1) — 무DB(메모리 저장소가 claim 규칙을 흉내 낸다; 실제 SQL 은 *.db.test 가 본다).
 *  - OFF 면 저장소·설치 엔진을 한 번도 부르지 않는다
 *  - default_on/required 만 설치, 게시자 본인은 건너뛴다, 두 번(동시에) 돌아도 한 번 설치
 *  - default_on 을 멤버가 지우면 다시 설치하지 않고, required 는 다시 설치한다
 *  - required 제거는 일반 멤버 거절, 조직 owner/admin·시스템 admin 허용
 */
import { resetConfig } from '../../../config/env';
import {
    decideExtensionRemoval,
    galleryDeploymentModes,
    installedDeploymentInfo,
    reconcileMemberDeployments,
    recordExtensionRemoval,
    resetOrgDeploymentState,
    runOrgDeploymentReconcile,
    type OrgDeploymentDeps,
} from '../org-deployment';
import type { MemberDeploymentInputRow, MemberInstallRow } from '../../../data/repositories/extension-org-deployment-repository';
import type { DeploymentMode } from '../../../config/extension-org-deployment';
import type { OrgMembership } from '../../../data/repositories/organization-repository';

const FLAG = 'EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED';
const ORIGINAL = process.env[FLAG];
function setFlag(on: boolean) {
    if (on) process.env[FLAG] = 'true'; else delete process.env[FLAG];
    resetConfig();
}

function source(id: string, ownerId: string, itemMode: DeploymentMode | null, groupModes: DeploymentMode[] = []): MemberDeploymentInputRow {
    return { id, user_id: ownerId, name: id, source_url: `https://github.com/o/${id}`, source_path: '', tracking_ref: null, item_mode: itemMode, group_modes: groupModes } as unknown as MemberDeploymentInputRow;
}

/** 메모리 저장소 — claimInstall 은 SQL 과 같은 조건으로 한 번에(동기) 판정한다 */
function makeDeps(opts: { inputs: MemberDeploymentInputRow[]; role?: OrgMembership['role']; installFails?: boolean; activeOrg?: string | null }) {
    const installs = new Map<string, MemberInstallRow>();
    const activeInstalls = new Set<string>();
    let seq = 0;
    const key = (s: string, u: string) => `${s}|${u}`;
    const install = jest.fn(async (shared: { id: string }, userId: string) => {
        await new Promise((r) => setImmediate(r));
        if (opts.installFails) throw new Error('git 조회 실패 token=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
        const id = `inst-${shared.id}-${userId}-${++seq}`;
        activeInstalls.add(id);
        return { extensionId: id };
    });
    const repo = {
        listMemberInputs: jest.fn(async () => opts.inputs),
        listReconcileCandidates: jest.fn(async () => [{ user_id: 'u-m', org_id: 'o1' }]),
        claimInstall: jest.fn(async (s: string, u: string, org: string, mode: DeploymentMode) => {
            const cur = installs.get(key(s, u));
            const reclaim = !cur
                || (cur.state === 'failed' && cur.attempts < 5)
                || (mode === 'required' && cur.state === 'user_removed')
                || (mode === 'required' && cur.state === 'installed' && !activeInstalls.has(cur.installed_extension_id ?? ''));
            if (!reclaim) return null;
            const row = { source_extension_id: s, user_id: u, org_id: org, installed_extension_id: cur?.installed_extension_id ?? null, state: 'installing', attempts: (cur?.attempts ?? 0) + 1, last_error: null } as MemberInstallRow;
            installs.set(key(s, u), row);
            return row;
        }),
        markInstalled: jest.fn(async (s: string, u: string, inst: string) => {
            const row = installs.get(key(s, u))!; row.state = 'installed'; row.installed_extension_id = inst;
        }),
        markFailed: jest.fn(async (s: string, u: string, err: string) => {
            const row = installs.get(key(s, u))!; row.state = 'failed'; row.last_error = err;
        }),
        markUserRemoved: jest.fn(async (s: string, u: string) => {
            const row = installs.get(key(s, u))!; row.state = 'user_removed';
            if (row.installed_extension_id) activeInstalls.delete(row.installed_extension_id);
        }),
        findByInstalledExtension: jest.fn(async (inst: string, u: string) =>
            [...installs.values()].find((r) => r.installed_extension_id === inst && r.user_id === u) ?? null),
        listInstallsForUser: jest.fn(async (u: string) => [...installs.values()].filter((r) => r.user_id === u && r.installed_extension_id)),
    };
    const activeOrgId = opts.activeOrg === undefined ? 'o1' : opts.activeOrg;
    const deps: OrgDeploymentDeps = {
        repo,
        install,
        activeOrg: jest.fn(async () => (activeOrgId ? { orgId: activeOrgId, orgRole: opts.role ?? 'member' } : null)),
        memberships: jest.fn(async () => [{ orgId: 'o1', role: opts.role ?? 'member', name: 'Org' } as OrgMembership]),
    };
    return { deps, repo, install, installs };
}

beforeEach(() => { resetOrgDeploymentState(); setFlag(true); });
afterAll(() => {
    if (ORIGINAL === undefined) delete process.env[FLAG]; else process.env[FLAG] = ORIGINAL;
    resetConfig();
});

describe('플래그 OFF — 종전과 같다', () => {
    beforeEach(() => setFlag(false));
    test('조정·tick·판정·장식 모두 저장소와 설치 엔진을 부르지 않는다', async () => {
        const { deps, repo, install } = makeDeps({ inputs: [source('s1', 'u-pub', 'required')] });
        expect(await reconcileMemberDeployments('u-m', { deps })).toEqual({ orgId: null, installed: 0, failed: 0 });
        expect(await runOrgDeploymentReconcile({ deps })).toEqual({ members: 0, installed: 0, failed: 0 });
        expect(await decideExtensionRemoval('inst-x', 'u-m', false, { deps })).toEqual({ allowed: true, link: null, mode: null });
        expect(await installedDeploymentInfo('u-m', false, { deps })).toBeNull();
        expect(await galleryDeploymentModes('u-m', { deps })).toBeNull();
        expect(install).not.toHaveBeenCalled();
        for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
        expect(deps.activeOrg).not.toHaveBeenCalled();
    });
});

describe('reconcileMemberDeployments', () => {
    test('default_on·required 만 설치하고 default_off·게시자 본인은 건너뛴다', async () => {
        const { deps, install } = makeDeps({ inputs: [
            source('off', 'u-pub', null),
            source('on', 'u-pub', 'default_on'),
            source('req', 'u-pub', 'required'),
            source('mine', 'u-m', 'required'),
        ] });
        const s = await reconcileMemberDeployments('u-m', { deps });
        expect(s).toEqual({ orgId: 'o1', installed: 2, failed: 0 });
        expect(install.mock.calls.map((c) => (c[0] as { id: string }).id).sort()).toEqual(['on', 'req']);
    });

    test('그룹 덮어쓰기 해석을 따른다 (기본 required 라도 그룹이 default_off 면 설치 안 함)', async () => {
        const { deps, install } = makeDeps({ inputs: [source('a', 'u-pub', 'required', ['default_off']), source('b', 'u-pub', null, ['default_off', 'default_on'])] });
        await reconcileMemberDeployments('u-m', { deps });
        expect(install.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['b']);
    });

    test('멱등 — 두 번 돌아도 한 번 설치', async () => {
        const { deps, install } = makeDeps({ inputs: [source('on', 'u-pub', 'default_on')] });
        await reconcileMemberDeployments('u-m', { deps });
        await reconcileMemberDeployments('u-m', { deps });
        expect(install).toHaveBeenCalledTimes(1);
    });

    test('동시성 — 같은 멤버 조정이 겹쳐도 한 번 설치', async () => {
        const { deps, install } = makeDeps({ inputs: [source('on', 'u-pub', 'default_on')] });
        await Promise.all([reconcileMemberDeployments('u-m', { deps }), reconcileMemberDeployments('u-m', { deps }), runOrgDeploymentReconcile({ deps })]);
        expect(install).toHaveBeenCalledTimes(1);
    });

    test('활성 조직이 없으면 아무것도 하지 않는다', async () => {
        const { deps, install } = makeDeps({ inputs: [source('on', 'u-pub', 'default_on')], activeOrg: null });
        expect((await reconcileMemberDeployments('u-m', { deps })).orgId).toBeNull();
        expect(install).not.toHaveBeenCalled();
    });

    test('설치 실패는 failed 로 기록하고 사유의 자격증명은 가린다', async () => {
        const { deps, repo } = makeDeps({ inputs: [source('on', 'u-pub', 'default_on')], installFails: true });
        const s = await reconcileMemberDeployments('u-m', { deps });
        expect(s.failed).toBe(1);
        const msg = repo.markFailed.mock.calls[0][2] as string;
        expect(msg).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    });

    test('tick 설치 예산(maxInstalls)을 넘지 않는다', async () => {
        const { deps, install } = makeDeps({ inputs: [source('a', 'u-pub', 'default_on'), source('b', 'u-pub', 'default_on'), source('c', 'u-pub', 'default_on')] });
        await reconcileMemberDeployments('u-m', { deps, maxInstalls: 2 });
        expect(install).toHaveBeenCalledTimes(2);
    });
});

describe('제거 — 기록·거절', () => {
    async function installedFor(mode: DeploymentMode, role: OrgMembership['role'] = 'member') {
        const ctx = makeDeps({ inputs: [source('s1', 'u-pub', mode)], role });
        await reconcileMemberDeployments('u-m', { deps: ctx.deps });
        const instId = [...ctx.installs.values()][0].installed_extension_id!;
        return { ...ctx, instId };
    }

    test('default_on 을 멤버가 지우면 user_removed 로 남고 다시 설치하지 않는다', async () => {
        const { deps, install, instId } = await installedFor('default_on');
        const d = await decideExtensionRemoval(instId, 'u-m', false, { deps });
        expect(d.allowed).toBe(true);
        expect(d.mode).toBe('default_on');
        await recordExtensionRemoval(d.link!, { deps });
        await reconcileMemberDeployments('u-m', { deps });
        expect(install).toHaveBeenCalledTimes(1);
    });

    test('required 는 일반 멤버 제거 거절', async () => {
        const { deps, instId } = await installedFor('required');
        const d = await decideExtensionRemoval(instId, 'u-m', false, { deps });
        expect(d).toMatchObject({ allowed: false, mode: 'required' });
        const info = await installedDeploymentInfo('u-m', false, { deps });
        expect(info?.get(instId)).toEqual({ mode: 'required', removable: false });
    });

    test.each([['owner'], ['admin']] as const)('required 는 조직 %s 가 지울 수 있고, 모드가 남아 있으면 다시 설치된다', async (role) => {
        const { deps, install, instId } = await installedFor('required', role);
        const d = await decideExtensionRemoval(instId, 'u-m', false, { deps });
        expect(d.allowed).toBe(true);
        await recordExtensionRemoval(d.link!, { deps });
        await reconcileMemberDeployments('u-m', { deps });
        expect(install).toHaveBeenCalledTimes(2);
    });

    test('required 는 시스템 admin 이 지울 수 있다', async () => {
        const { deps, instId } = await installedFor('required');
        expect((await decideExtensionRemoval(instId, 'u-m', true, { deps })).allowed).toBe(true);
    });

    test('배포 설치본이 아니면 판정 없이 허용(종전)', async () => {
        const { deps } = makeDeps({ inputs: [] });
        expect(await decideExtensionRemoval('manual-ext', 'u-m', false, { deps })).toEqual({ allowed: true, link: null, mode: null });
    });

    test('조직을 떠났으면 required 라도 지울 수 있다', async () => {
        const { deps, instId } = await installedFor('required');
        (deps.memberships as jest.Mock).mockResolvedValue([]);
        expect((await decideExtensionRemoval(instId, 'u-m', false, { deps })).allowed).toBe(true);
    });
});

describe('galleryDeploymentModes', () => {
    test('활성 조직 항목의 적용 모드', async () => {
        const { deps } = makeDeps({ inputs: [source('a', 'u-pub', 'required'), source('b', 'u-pub', null, ['default_on'])] });
        const m = await galleryDeploymentModes('u-m', { deps });
        expect(Object.fromEntries(m!)).toEqual({ a: 'required', b: 'default_on' });
    });
});
