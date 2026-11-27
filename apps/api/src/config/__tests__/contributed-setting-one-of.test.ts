/**
 * add-on 기여 설정의 열거형 검증기(`oneOf`) — 허용 값만 저장된다. MCP-2 `MCP_PROTOCOL_NEGOTIATION` 이 첫 소비처.
 */
import { contributedValidator, SETTING_DEFS_BY_KEY } from '../system-settings-registry';

describe('contributedValidator oneOf', () => {
    const v = contributedValidator({ validate: 'oneOf', allowedValues: ['legacy', 'auto'] });

    it('허용 값(앞뒤 공백 허용)만 통과', () => {
        expect(v.safeParse('legacy').success).toBe(true);
        expect(v.safeParse(' auto ').success).toBe(true);
        expect(v.safeParse('AUTO').success).toBe(false);
        expect(v.safeParse('').success).toBe(false);
    });

    it('허용 값 목록이 없으면 어떤 값도 저장할 수 없다', () => {
        expect(contributedValidator({ validate: 'oneOf' }).safeParse('legacy').success).toBe(false);
    });

    it('기존 검증기 이름은 그대로', () => {
        expect(contributedValidator({ validate: 'boolean' }).safeParse('true').success).toBe(true);
        expect(contributedValidator({ validate: 'boolean' }).safeParse('yes').success).toBe(false);
    });
});

describe('MCP-2 기여 설정 등록', () => {
    it('MCP_PROTOCOL_NEGOTIATION 은 legacy·auto 만, 탐지 타임아웃은 0 이상 정수', () => {
        const mode = SETTING_DEFS_BY_KEY.get('MCP_PROTOCOL_NEGOTIATION');
        expect(mode).toBeDefined();
        expect(mode!.requiresRestart).toBe(false);
        expect(mode!.validate.safeParse('auto').success).toBe(true);
        expect(mode!.validate.safeParse('modern').success).toBe(false);
        expect((mode as unknown as Record<string, unknown>).allowedValues).toBeUndefined();
        const timeout = SETTING_DEFS_BY_KEY.get('MCP_NEGOTIATION_PROBE_TIMEOUT_MS');
        expect(timeout!.validate.safeParse('5000').success).toBe(true);
        expect(timeout!.validate.safeParse('-1').success).toBe(false);
    });
});
