import { buildSchedulingFields, mergeExtraBody } from '../scheduling-fields';
import { LLM_REQUEST_PRIORITY } from '../../config/llm-priority';
import { LLM_REQUEST_CLASSES } from '../request-metrics';

const base = { saltMode: 'off' as const, priorityEnabled: false, external: false, userId: '3', saltKey: 'pepper' };

describe('buildSchedulingFields — 플래그 기본 OFF', () => {
    it('두 플래그가 꺼져 있으면 아무 필드도 싣지 않는다', () => {
        expect(buildSchedulingFields(base)).toEqual({});
    });

    it('salt=user 면 사용자별로 결정적인 32자 salt, 원 userId 는 싣지 않는다', () => {
        const a = buildSchedulingFields({ ...base, saltMode: 'user' }).cache_salt as string;
        const again = buildSchedulingFields({ ...base, saltMode: 'user' }).cache_salt;
        const other = buildSchedulingFields({ ...base, saltMode: 'user', userId: '4' }).cache_salt;
        expect(a).toMatch(/^[0-9a-f]{32}$/);
        expect(again).toBe(a);
        expect(other).not.toBe(a);
        const longId = 'user-identifier-visible-in-logs';
        expect(buildSchedulingFields({ ...base, saltMode: 'user', userId: longId }).cache_salt).not.toContain(longId);
    });

    it('userId·키가 없으면 salt 를 싣지 않는다(추측 가능한 salt 금지)', () => {
        expect(buildSchedulingFields({ ...base, saltMode: 'user', userId: null })).toEqual({});
        expect(buildSchedulingFields({ ...base, saltMode: 'user', saltKey: '' })).toEqual({});
    });

    it('외부 provider 요청에는 어떤 플래그든 싣지 않는다', () => {
        expect(buildSchedulingFields({ ...base, saltMode: 'user', priorityEnabled: true, external: true })).toEqual({});
    });

    it('priority 는 요청 클래스 맵을 따르고 미지정은 unspecified', () => {
        expect(buildSchedulingFields({ ...base, priorityEnabled: true, requestClass: 'interactive' })).toEqual({ priority: 0 });
        expect(buildSchedulingFields({ ...base, priorityEnabled: true, requestClass: 'background' })).toEqual({ priority: 3 });
        expect(buildSchedulingFields({ ...base, priorityEnabled: true })).toEqual({ priority: LLM_REQUEST_PRIORITY.unspecified });
    });

    it('모든 요청 클래스에 정수 priority 가 있고 채팅이 가장 앞선다', () => {
        for (const c of LLM_REQUEST_CLASSES) expect(Number.isInteger(LLM_REQUEST_PRIORITY[c])).toBe(true);
        expect(Math.min(...LLM_REQUEST_CLASSES.map((c) => LLM_REQUEST_PRIORITY[c]))).toBe(LLM_REQUEST_PRIORITY.interactive);
    });
});

describe('mergeExtraBody', () => {
    it('필드가 없으면 원래 값(undefined 포함)을 그대로 돌려준다', () => {
        expect(mergeExtraBody(undefined, {})).toBeUndefined();
        const body = { chat_template_kwargs: { enable_thinking: false } };
        expect(mergeExtraBody(body, {})).toBe(body);
    });

    it('reasoning 필드와 스케줄링 필드를 합친다', () => {
        expect(mergeExtraBody({ reasoning_effort: 'low' }, { priority: 1 })).toEqual({ reasoning_effort: 'low', priority: 1 });
        expect(mergeExtraBody(undefined, { cache_salt: 'x' })).toEqual({ cache_salt: 'x' });
    });
});
