/**
 * 세션 목록 model — 마지막 답변의 모델. 첫 메시지(사용자 메시지)는 provider 해석 전의 엔진 기본값으로 저장돼,
 * 외부 모델이 답한 대화가 로컬 기본 모델명으로 보였다(2026-11-16 라이브).
 */
import { sessionDisplayModel } from '../session.controller';

const msg = (role: 'user' | 'assistant', model?: string) => ({ role, ...(model ? { model } : {}) });

describe('sessionDisplayModel', () => {
    it('마지막 assistant 메시지의 모델을 쓴다', () => {
        expect(sessionDisplayModel([msg('user', 'local-default'), msg('assistant', 'gemini:gemini-2.5-flash'), msg('user', 'local-default'), msg('assistant', 'qwen-x')]))
            .toBe('qwen-x');
        expect(sessionDisplayModel([msg('user', 'local-default'), msg('assistant', 'gemini:gemini-2.5-flash'), msg('user', 'local-default')]))
            .toBe('gemini:gemini-2.5-flash');
    });

    it('답변에 모델이 없으면 첫 메시지의 모델, 그것도 없으면 기본 문구', () => {
        expect(sessionDisplayModel([msg('user', 'local-default'), msg('assistant')])).toBe('local-default');
        expect(sessionDisplayModel([msg('user')])).toBe('OpenMake LLM Auto');
        expect(sessionDisplayModel(undefined)).toBe('OpenMake LLM Auto');
    });
});
