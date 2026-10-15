/**
 * 설치형 확장 권한 판정(순수) — 설계 §4 C3 · D4.
 * 매트릭스: 저장 상태(첫 설치·레거시·검토됨·재승인 필요) × 매니페스트 유무 × network 승인 유무.
 */
import {
    allowsNetwork,
    approvePermissions,
    describePermissions,
    effectiveRequested,
    evaluatePermissionState,
    normalizePermissions,
    permissionExcludedServers,
    revokePermissions,
    type PermissionEvaluation,
    type PermissionStateInput,
} from '../permission-state';

const NET = 'network:internet';
const DB = 'database:addon';

type Expected = Pick<PermissionEvaluation, 'next' | 'blocked' | 'granted' | 'effective' | 'reviewedNow'>;
const CASES: Array<[string, PermissionStateInput, Expected]> = [
    ['A: 첫 설치 · 매니페스트 없음 → 레거시(집행 없음)',
        { state: null, granted: null, requested: null },
        { next: 'legacy_unreviewed', blocked: [], granted: null, effective: undefined, reviewedNow: false }],
    ['B: 첫 설치 · [] → reviewed(설치자 승인), 네트워크 없음',
        { state: null, granted: null, requested: [] },
        { next: 'reviewed', blocked: [], granted: [], effective: [], reviewedNow: true }],
    ['C: 첫 설치 · [network] → reviewed',
        { state: null, granted: null, requested: [NET] },
        { next: 'reviewed', blocked: [], granted: [NET], effective: [NET], reviewedNow: true }],
    ['D: 레거시 + 매니페스트 없음은 그대로(종전 동작 보존)',
        { state: 'legacy_unreviewed', granted: null, requested: null },
        { next: 'legacy_unreviewed', blocked: [], granted: null, effective: undefined, reviewedNow: false }],
    ['E: 레거시에 매니페스트 [network] 가 생김 → 레거시가 쓰던 범위라 reviewed',
        { state: 'legacy_unreviewed', granted: null, requested: [NET] },
        { next: 'reviewed', blocked: [], granted: [NET], effective: [NET], reviewedNow: true }],
    ['F: 레거시에 매니페스트 [] 가 생김 → 좁아졌으니 reviewed',
        { state: 'legacy_unreviewed', granted: null, requested: [] },
        { next: 'reviewed', blocked: [], granted: [], effective: [], reviewedNow: true }],
    ['G: 레거시에 매니페스트가 레거시보다 넓게 요청 → 초과분만 막는다',
        { state: 'legacy_unreviewed', granted: null, requested: [DB, NET] },
        { next: 'review_required', blocked: [DB], granted: [NET], effective: [NET], reviewedNow: false }],
    ['H: 승인 [network] · 요청 [network] → reviewed',
        { state: 'reviewed', granted: [NET], requested: [NET] },
        { next: 'reviewed', blocked: [], granted: [NET], effective: [NET], reviewedNow: false }],
    ['I: 승인 [] · 요청 [network] → review_required, 기존 승인 범위 유지',
        { state: 'reviewed', granted: [], requested: [NET] },
        { next: 'review_required', blocked: [NET], granted: [], effective: [], reviewedNow: false }],
    ['J: 승인 [network] · 요청 [] → 좁아진 요청은 승인 없이 reviewed',
        { state: 'reviewed', granted: [NET], requested: [] },
        { next: 'reviewed', blocked: [], granted: [NET], effective: [], reviewedNow: false }],
    ['K: 매니페스트가 사라진 업데이트는 네트워크를 다시 요구한 것으로 본다',
        { state: 'reviewed', granted: [], requested: null },
        { next: 'review_required', blocked: [NET], granted: [], effective: [], reviewedNow: false }],
    ['L: 레거시를 재승인한 뒤(승인 [network]) 매니페스트 없는 업데이트 → reviewed',
        { state: 'reviewed', granted: [NET], requested: null },
        { next: 'reviewed', blocked: [], granted: [NET], effective: [NET], reviewedNow: false }],
    ['M: review_required 였지만 업데이트가 초과분을 거둬들임 → reviewed',
        { state: 'review_required', granted: [], requested: [] },
        { next: 'reviewed', blocked: [], granted: [], effective: [], reviewedNow: false }],
    ['N: 어휘 밖 문자열은 버린다(승인·요청 모두)',
        { state: 'reviewed', granted: [NET, 'files:read'], requested: ['files:read'] },
        { next: 'reviewed', blocked: [], granted: [NET], effective: [], reviewedNow: false }],
];

describe('evaluatePermissionState — 판정 매트릭스', () => {
    it.each(CASES)('%s', (_title, input, expected) => {
        expect(evaluatePermissionState(input)).toMatchObject(expected);
    });

    it('요청 권한은 중복을 지우고 정렬해 돌려준다(저장 값이 판정과 같은 모양)', () => {
        const e = evaluatePermissionState({ state: null, granted: null, requested: [NET, DB, NET] });
        expect(e.requested).toEqual([DB, NET]);
        expect(e.granted).toEqual([DB, NET]);
    });
});

describe('normalizePermissions·effectiveRequested', () => {
    it('null·undefined 는 null, 배열은 어휘 안 값만', () => {
        expect(normalizePermissions(null)).toBeNull();
        expect(normalizePermissions(undefined)).toBeNull();
        expect(normalizePermissions([NET, 7, 'x', DB])).toEqual([DB, NET]);
    });
    it('매니페스트가 없으면 레거시 묵시 권한(network)을 요청한 것으로 본다', () => {
        expect(effectiveRequested(null)).toEqual([NET]);
        expect(effectiveRequested([])).toEqual([]);
    });
});

describe('approvePermissions', () => {
    it('매니페스트 없는 레거시는 레거시 묵시 권한을 승인한다', () => {
        expect(approvePermissions({ requested: null })).toEqual({
            next: 'reviewed', blocked: [], granted: [NET], requested: null, effective: [NET], reviewedNow: true,
        });
    });
    it('매니페스트가 있으면 요청 그대로 승인한다', () => {
        expect(approvePermissions({ requested: [NET] })).toMatchObject({ next: 'reviewed', granted: [NET], effective: [NET] });
        expect(approvePermissions({ requested: [] })).toMatchObject({ next: 'reviewed', granted: [], effective: [] });
    });
});

describe('revokePermissions', () => {
    it('승인 [network] 에서 network 철회 → review_required, 승인 기록을 남긴다', () => {
        expect(revokePermissions({ state: 'reviewed', granted: [NET], requested: [NET] }, [NET])).toMatchObject({
            next: 'review_required', granted: [], blocked: [NET], effective: [], reviewedNow: true,
        });
    });
    it('레거시에서 network 철회 → 묵시 권한에서 뺀다(review_required)', () => {
        expect(revokePermissions({ state: 'legacy_unreviewed', granted: null, requested: null }, [NET])).toMatchObject({
            next: 'review_required', granted: [], blocked: [NET], reviewedNow: true,
        });
    });
    it('승인하지 않은 권한을 철회하면 상태는 그대로, 승인 기록도 남기지 않는다(reviewedNow false)', () => {
        expect(revokePermissions({ state: 'reviewed', granted: [NET], requested: [NET] }, [DB])).toMatchObject({
            next: 'reviewed', granted: [NET], blocked: [], reviewedNow: false,
        });
        expect(revokePermissions({ state: 'review_required', granted: [], requested: [NET] }, [NET])).toMatchObject({
            reviewedNow: false,
        });
    });
    it('레거시에서 묵시 권한 밖을 철회하면 바뀐 것 없음(reviewedNow false)', () => {
        expect(revokePermissions({ state: 'legacy_unreviewed', granted: null, requested: null }, [DB])).toMatchObject({
            reviewedNow: false,
        });
    });
});

describe('allowsNetwork', () => {
    it('레거시(effective undefined)는 열려 있고, 그 밖은 network 포함 여부', () => {
        expect(allowsNetwork({ effective: undefined })).toBe(true);
        expect(allowsNetwork({ effective: [] })).toBe(false);
        expect(allowsNetwork({ effective: [NET] })).toBe(true);
    });
});

describe('describePermissions', () => {
    it('레거시 행', () => {
        expect(describePermissions({
            permission_state: 'legacy_unreviewed', permissions_granted: null, permissions_requested: null, permissions_reviewed_at: null,
        })).toEqual({ state: 'legacy_unreviewed', granted: null, requested: null, blocked: [], reviewedAt: null });
    });
    it('재승인 필요 행은 막힌 권한을 다시 계산하고 시각은 ISO 문자열', () => {
        expect(describePermissions({
            permission_state: 'review_required', permissions_granted: [], permissions_requested: [NET],
            permissions_reviewed_at: new Date('2026-10-16T01:02:03Z'),
        })).toEqual({ state: 'review_required', granted: [], requested: [NET], blocked: [NET], reviewedAt: '2026-10-16T01:02:03.000Z' });
    });
    it('저장 시각이 날짜로 읽히지 않으면 reviewedAt null — 조회가 RangeError 로 실패하지 않는다', () => {
        expect(describePermissions({
            permission_state: 'reviewed', permissions_granted: [NET], permissions_requested: [NET], permissions_reviewed_at: 'not-a-date',
        }).reviewedAt).toBeNull();
    });
});

describe('permissionExcludedServers', () => {
    it('권한 때문에 설치에서 빠진 MCP 서버 이름만', () => {
        expect(permissionExcludedServers({
            components: {
                mcpServers: [
                    { name: 'cloud', error: 'PERMISSION_DENIED: network:internet 권한 없음' },
                    { name: 'cloud2', error: 'PERMISSION_REVIEW_REQUIRED: network:internet 재승인 필요' },
                    { name: 'broken', error: 'spawn failed' },
                    { name: 'ok', serverId: 'mcp-1' },
                ],
            },
        })).toEqual(['cloud', 'cloud2']);
    });
    it('구성요소 기록이 없으면 빈 배열', () => {
        expect(permissionExcludedServers(null)).toEqual([]);
        expect(permissionExcludedServers({ components: {} })).toEqual([]);
    });
    it('저장 JSON 이 어긋나도 던지지 않는다 — 배열 아님·null 요소·이름 없음은 건너뛴다', () => {
        expect(permissionExcludedServers({ components: { mcpServers: 'x' } })).toEqual([]);
        expect(permissionExcludedServers({ components: null })).toEqual([]);
        expect(permissionExcludedServers({
            components: {
                mcpServers: [
                    null,
                    'cloud',
                    { error: 'PERMISSION_DENIED: network:internet 권한 없음' },
                    { name: 'cloud', error: 'PERMISSION_DENIED: network:internet 권한 없음' },
                ],
            },
        })).toEqual(['cloud']);
    });
});
