/** 확장 권한 상태 화면 분류(apps/web/lib/extension-permission-state.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
type Kind = 'reviewed' | 'legacy' | 'reviewRequired' | 'unknown';
interface Fields { permission_state?: string | null; permissions_granted?: string[] | null; permissions_requested?: string[] | null }
interface ViewResponse { state: string; granted: string[] | null; requested: string[] | null; blocked: string[]; reviewedAt: string | null }
const lib = require('../../../../web/lib/extension-permission-state') as {
    extensionPermissionView: (ext: Fields) => { kind: Kind; requested: string[]; blocked: string[]; canApprove: boolean };
    permissionBadgeKey: (kind: Kind) => string | null;
    permissionImpactKey: (kind: Kind) => string | null;
    permissionToneClass: (kind: Kind) => string;
    permissionLabelKey: (permission: string) => string | null;
    permissionFieldsFromView: (view: ViewResponse) => Fields;
    approveOutcomeMessages: (res: { permissions: ViewResponse; restoredServers: number; excludedRemoteServers: string[] }) => unknown[];
    approveErrorKey: (status: number | undefined) => string;
};

const NET = 'network:internet';

describe('extensionPermissionView', () => {
    it('레거시 — 요청 권한은 레거시 묵시 권한, 막힌 것 없음, 재승인 가능', () => {
        expect(lib.extensionPermissionView({ permission_state: 'legacy_unreviewed', permissions_granted: null, permissions_requested: null }))
            .toEqual({ kind: 'legacy', requested: [NET], blocked: [], canApprove: true });
    });
    it('재승인 필요 — 요청 중 승인 밖만 막힘', () => {
        expect(lib.extensionPermissionView({ permission_state: 'review_required', permissions_granted: [], permissions_requested: [NET] }))
            .toEqual({ kind: 'reviewRequired', requested: [NET], blocked: [NET], canApprove: true });
    });
    it('검토됨 — 재승인 버튼 없음', () => {
        expect(lib.extensionPermissionView({ permission_state: 'reviewed', permissions_granted: [NET], permissions_requested: [] }))
            .toEqual({ kind: 'reviewed', requested: [], blocked: [], canApprove: false });
    });
    it('서버가 권한 열을 주지 않거나(구 API) 모르는 값이면 unknown — 배지를 그리지 않는다', () => {
        expect(lib.extensionPermissionView({}).kind).toBe('unknown');
        expect(lib.extensionPermissionView({ permission_state: 'toString' }).kind).toBe('unknown');
        expect(lib.extensionPermissionView({}).canApprove).toBe(false);
    });
});

describe('키·색 매핑', () => {
    it('배지·영향 문구 키', () => {
        expect(lib.permissionBadgeKey('reviewed')).toBe('badge.reviewed');
        expect(lib.permissionBadgeKey('legacy')).toBe('badge.legacy');
        expect(lib.permissionBadgeKey('reviewRequired')).toBe('badge.reviewRequired');
        expect(lib.permissionBadgeKey('unknown')).toBeNull();
        expect(lib.permissionImpactKey('legacy')).toBe('impact.legacy');
        expect(lib.permissionImpactKey('unknown')).toBeNull();
    });
    it('색 — 재승인 필요는 경고색', () => {
        expect(lib.permissionToneClass('reviewRequired')).toBe('text-warn');
        expect(lib.permissionToneClass('reviewed')).toBe('text-success');
        expect(lib.permissionToneClass('legacy')).toBe('text-muted');
    });
    it('권한 이름 키 — 모르는 권한은 null(원문 표시)', () => {
        expect(lib.permissionLabelKey(NET)).toBe('label.network');
        expect(lib.permissionLabelKey('database:addon')).toBe('label.database');
        expect(lib.permissionLabelKey('files:read')).toBeNull();
    });
});

describe('재승인 응답 처리', () => {
    const view: ViewResponse = { state: 'reviewed', granted: [NET], requested: null, blocked: [], reviewedAt: '2026-10-16T00:00:00.000Z' };
    it('응답 → 목록 행 열', () => {
        expect(lib.permissionFieldsFromView(view)).toEqual({ permission_state: 'reviewed', permissions_granted: [NET], permissions_requested: null });
    });
    it('결과 문구 — 승인, 복원 수, 재설치 안내', () => {
        expect(lib.approveOutcomeMessages({ permissions: view, restoredServers: 0, excludedRemoteServers: [] })).toEqual([{ key: 'approved' }]);
        expect(lib.approveOutcomeMessages({ permissions: view, restoredServers: 2, excludedRemoteServers: ['cloud', 'sync'] })).toEqual([
            { key: 'approved' }, { key: 'restored', count: 2 }, { key: 'reinstallRemote', names: 'cloud, sync' },
        ]);
    });
    it('오류 — 409 는 경합 안내, 그 밖은 일반 실패', () => {
        expect(lib.approveErrorKey(409)).toBe('conflict');
        expect(lib.approveErrorKey(500)).toBe('approveFailed');
        expect(lib.approveErrorKey(undefined)).toBe('approveFailed');
    });
});
