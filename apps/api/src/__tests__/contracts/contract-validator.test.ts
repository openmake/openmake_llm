/**
 * 계약 검증기 메타 테스트 — 검증기가 실제로 위반을 잡는지 확인.
 * (필드 누락 시 fail 이 나야 계약 테스트 전체가 유의미하다 — plan Step 4 verify)
 */
import { validateContract } from './contract-validator';
import { success } from '../../utils/api-response';

const sampleUser = {
    id: 'u1',
    email: 'riskpw@openmake.cc',
    role: 'user',
    created_at: '2026-08-16T00:00:00.000Z',
    is_active: true,
};

describe('contract-validator 메타', () => {
    test('정상 envelope 응답은 통과', () => {
        const body = success({ success: true, token: 'at', user: sampleUser });
        expect(validateContract('/api/auth/login', 'post', '200', body).valid).toBe(true);
    });

    test('필수 필드(meta) 제거 시 실패', () => {
        const body = success({ success: true, token: 'at', user: sampleUser }) as unknown as Record<string, unknown>;
        delete body.meta;
        const r = validateContract('/api/auth/login', 'post', '200', body);
        expect(r.valid).toBe(false);
        expect(r.errors).toContain('meta');
    });

    test('중첩 필수 필드(ChatMessage.role) 누락 시 실패', () => {
        const body = success({ messages: [{ content: 'hi' }] });
        const r = validateContract('/api/chat/sessions/{sessionId}/messages', 'get', '200', body);
        expect(r.valid).toBe(false);
        expect(r.errors).toContain('role');
    });

    test('미지 추가 필드는 허용 (forward-compat — additionalProperties 미제한)', () => {
        const body = success({ messages: [{ role: 'user', content: 'hi', futureField: 1 }] });
        expect(
            validateContract('/api/chat/sessions/{sessionId}/messages', 'get', '200', body).valid,
        ).toBe(true);
    });

    test('존재하지 않는 계약 좌표는 컴파일 에러 (오타 방어)', () => {
        expect(() => validateContract('/api/no-such', 'get', '200', {})).toThrow();
    });
});
