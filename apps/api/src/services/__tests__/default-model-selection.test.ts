/**
 * 저장된 기본 모델 판정 — 지금 쓸 수 있는가, 못 쓰면 무엇으로 답하는가(2026-11-18 설계 §3.2).
 */
import { judgeDefaultModelSelection } from '../default-model-selection';

const base = { localModelIds: ['qwen-test'], keys: [] as Array<{ providerId: string; enabled: boolean }>, unusable: new Set<string>() };

describe('judgeDefaultModelSelection', () => {
    test('외부 모델의 키가 꺼져 있으면 key_disabled·effective=default, saved 는 보존', () => {
        const r = judgeDefaultModelSelection({
            ...base,
            saved: 'gemini:gemini-2.5-flash',
            keys: [{ providerId: 'gemini', enabled: false }],
        });
        expect(r).toEqual({ saved: 'gemini:gemini-2.5-flash', effective: 'default', status: 'key_disabled' });
    });

    test('키가 켜져 있으면 목록에 없어도 ok (일시 조회 실패로 내리지 않는다)', () => {
        const r = judgeDefaultModelSelection({
            ...base,
            saved: 'gemini:gemini-2.5-flash',
            keys: [{ providerId: 'gemini', enabled: true }],
        });
        expect(r).toEqual({ saved: 'gemini:gemini-2.5-flash', effective: 'gemini:gemini-2.5-flash', status: 'ok' });
    });

    test('키 행이 없으면 key_missing', () => {
        const r = judgeDefaultModelSelection({ ...base, saved: 'gemini:gemini-2.5-flash', keys: [{ providerId: 'hasa', enabled: true }] });
        expect(r).toEqual({ saved: 'gemini:gemini-2.5-flash', effective: 'default', status: 'key_missing' });
    });

    test('unusable 집합에 있으면 unusable', () => {
        const r = judgeDefaultModelSelection({
            ...base,
            saved: 'gemini:gemini-2.5-pro',
            keys: [{ providerId: 'gemini', enabled: true }],
            unusable: new Set(['gemini:gemini-2.5-pro']),
        });
        expect(r).toEqual({ saved: 'gemini:gemini-2.5-pro', effective: 'default', status: 'unusable' });
    });

    test("saved 없음·''·'default' 는 auto", () => {
        expect(judgeDefaultModelSelection({ ...base, saved: undefined })).toEqual({ saved: null, effective: 'default', status: 'auto' });
        expect(judgeDefaultModelSelection({ ...base, saved: 42 })).toEqual({ saved: null, effective: 'default', status: 'auto' });
        expect(judgeDefaultModelSelection({ ...base, saved: '' })).toEqual({ saved: '', effective: 'default', status: 'auto' });
        expect(judgeDefaultModelSelection({ ...base, saved: 'default' })).toEqual({ saved: 'default', effective: 'default', status: 'auto' });
    });

    test('로컬 카탈로그에 있는 local-llm 모델은 ok', () => {
        expect(judgeDefaultModelSelection({ ...base, saved: 'local-llm:qwen-test' }))
            .toEqual({ saved: 'local-llm:qwen-test', effective: 'local-llm:qwen-test', status: 'ok' });
    });

    test('로컬 카탈로그에 없는 local-llm 모델·형식 오류는 not_listed', () => {
        for (const saved of ['local-llm:gone', 'no-colon', ':model', 'gemini:']) {
            expect(judgeDefaultModelSelection({ ...base, saved })).toEqual({ saved, effective: 'default', status: 'not_listed' });
        }
    });
});
