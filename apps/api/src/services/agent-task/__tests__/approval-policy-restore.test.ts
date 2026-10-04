import { effectiveApprovalPolicy, policyToPersist } from '../approval-policy-restore';

describe('effectiveApprovalPolicy — 재개 때 처음의 승인 정책을 되살린다', () => {
    it('요청이 정책을 주면 그대로 쓴다(저장값보다 앞선다)', () => {
        expect(effectiveApprovalPolicy({ approvalPolicy: 'high-risk', resume: {} }, 'none')).toBe('high-risk');
    });

    it('재개인데 요청에 정책이 없으면 저장된 정책을 쓴다', () => {
        expect(effectiveApprovalPolicy({ resume: {} }, 'none')).toBe('none');
    });

    it('새 시작은 저장값을 보지 않는다', () => {
        expect(effectiveApprovalPolicy({}, 'none')).toBeUndefined();
    });

    it('저장값이 없거나 모르는 값이면 정하지 않는다(실행기 기본값으로)', () => {
        expect(effectiveApprovalPolicy({ resume: {} }, null)).toBeUndefined();
        expect(effectiveApprovalPolicy({ resume: {} }, 'whatever')).toBeUndefined();
    });
});

describe('policyToPersist — 처음 시작할 때만 저장한다', () => {
    it('새 시작 + 정책 지정이면 저장할 값을 돌려준다', () => {
        expect(policyToPersist({ approvalPolicy: 'none' })).toBe('none');
    });

    it('재개이거나 정책이 없으면 저장하지 않는다(처음 값을 덮지 않는다)', () => {
        expect(policyToPersist({ approvalPolicy: 'all', resume: {} })).toBeNull();
        expect(policyToPersist({})).toBeNull();
    });
});
