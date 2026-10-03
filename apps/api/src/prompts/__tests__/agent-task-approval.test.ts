import { getApprovalRejectedNotice } from '../agent-task-approval';

describe('getApprovalRejectedNotice', () => {
    it('명시 거절 — 같은 결과를 다른 경로로 시도하지 말라고 한다("다른 방법을 시도"가 아니다)', () => {
        const out = getApprovalRejectedNotice('bash', 'user');
        expect(out).toContain('승인하지 않았습니다');
        expect(out).toContain('(bash)');
        expect(out).toContain('같은 결과를 다른 경로');
        expect(out).not.toContain('다른 방법을 시도');
        expect(out).not.toContain('사유');
    });

    it('사용자가 적은 사유를 그대로 싣는다', () => {
        const out = getApprovalRejectedNotice('file_ops', 'user', '  운영 설정 파일은 건드리지 마세요  ');
        expect(out).toContain('사용자가 밝힌 사유: "운영 설정 파일은 건드리지 마세요"');
        expect(out).toContain('같은 결과를 다른 경로');
    });

    it('무응답 만료는 종전 안내 그대로 — 사유가 와도 싣지 않는다', () => {
        const out = getApprovalRejectedNotice('bash', 'timeout', '무시');
        expect(out).toContain('승인 대기 시간이 초과되었습니다(무응답, bash)');
        expect(out).not.toContain('무시');
    });

    it('사유 미상(abort 등)은 명시 거절과 같은 문구', () => {
        expect(getApprovalRejectedNotice('bash', undefined)).toBe(getApprovalRejectedNotice('bash', 'user'));
        expect(getApprovalRejectedNotice('bash', 'abort')).toBe(getApprovalRejectedNotice('bash', 'user'));
    });
});
