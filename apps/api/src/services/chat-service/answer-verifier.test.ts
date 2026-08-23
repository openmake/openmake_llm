/**
 * 답변 검증 — 게이트·NONE 규약·fail-open 고정.
 *
 * 설계 근거(2026-08-23 프로토타입 실측): judge 모델이 로컬 답변의 사실오류를 정확히 잡았고
 * "없으면 NONE" 규약도 잘 지켰다. 반면 수정 왕복은 2건 중 1건에서 답변을 악화시켜(본문 소실)
 * 채택하지 않았다 — 여기서는 지적만 반환한다.
 */
const mockChat = jest.fn();
jest.mock('../model-role-resolver', () => ({
    resolveRoleClientForUser: jest.fn(async () => ({
        client: { derive: () => ({ chat: mockChat }) },
        fullId: 'chatgpt:gpt-5.6-luna',
    })),
}));

const LONG = 'x'.repeat(300);

function load(): typeof import('./answer-verifier') {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./answer-verifier');
}

describe('verifyAnswer', () => {
    const saved = process.env.ANSWER_VERIFICATION_ENABLED;
    beforeEach(() => { mockChat.mockReset(); process.env.ANSWER_VERIFICATION_ENABLED = 'true'; });
    afterAll(() => {
        if (saved !== undefined) process.env.ANSWER_VERIFICATION_ENABLED = saved;
        else delete process.env.ANSWER_VERIFICATION_ENABLED;
    });

    it('게이트가 꺼져 있으면 LLM 을 호출하지 않는다', async () => {
        process.env.ANSWER_VERIFICATION_ENABLED = 'false';
        const { verifyAnswer } = load();
        expect(await verifyAnswer('q', LONG)).toBeNull();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('짧은 답변은 검증하지 않는다 (인사·단답)', async () => {
        const { verifyAnswer } = load();
        expect(await verifyAnswer('q', '네')).toBeNull();
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('NONE 응답은 지적 없음으로 처리한다 (사용자에게 아무것도 안 보임)', async () => {
        mockChat.mockResolvedValue({ content: 'NONE' });
        const { verifyAnswer } = load();
        expect(await verifyAnswer('q', LONG)).toBeNull();
    });

    it('지적이 있으면 그대로 돌려준다 (자동 수정 없음)', async () => {
        mockChat.mockResolvedValue({ content: '의무가입 상한은 만 60세 미만이다.' });
        const { verifyAnswer } = load();
        expect(await verifyAnswer('q', LONG)).toBe('의무가입 상한은 만 60세 미만이다.');
    });

    it('검증 실패는 답변에 영향을 주지 않는다 (fail-open)', async () => {
        mockChat.mockRejectedValue(new Error('upstream 500'));
        const { verifyAnswer } = load();
        expect(await verifyAnswer('q', LONG)).toBeNull();
    });
});
