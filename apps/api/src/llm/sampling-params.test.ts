/**
 * 샘플링 파라미터 매핑 회귀.
 *
 * 배경(라이브 실측 2026-08-23): 내부 옵션 이름 `repeat_penalty` 는 Ollama 시절 유산이라
 * vLLM 이 모르는 필드다. 그대로 보내도 조용히 무시되고(같은 프롬프트에서 출력이 기본값과
 * 완전히 동일), 애초에 요청 매핑에 없어 전송조차 되지 않았다. vLLM 이 받는 이름은
 * `repetition_penalty` 이며 이 값으로 보내면 출력이 실제로 달라진다.
 */
import { applyOptionsToRequest } from './stream-parser';

describe('applyOptionsToRequest — 샘플링 파라미터 매핑', () => {
    it('repeat_penalty 를 vLLM 이름(repetition_penalty)으로 매핑한다 (핵심 회귀)', () => {
        const p = applyOptionsToRequest({ repeat_penalty: 1.15 });
        expect(p.repetition_penalty).toBe(1.15);
        // 내부 이름은 전송하지 않는다 — vLLM 이 무시하므로 노이즈일 뿐이다.
        expect(p.repeat_penalty).toBeUndefined();
    });

    it('미지정이면 아무 penalty 도 싣지 않는다 (서버 기본값 위임)', () => {
        expect(applyOptionsToRequest({ temperature: 0.7 })).toEqual({ temperature: 0.7 });
        expect(applyOptionsToRequest(undefined)).toEqual({});
    });

    it('표준 파라미터는 그대로 전달한다', () => {
        const p = applyOptionsToRequest({
            temperature: 0.3, top_p: 0.9, num_predict: 512, seed: 7, stop: ['x'],
            presence_penalty: 0.1, frequency_penalty: 0.2,
        });
        expect(p).toMatchObject({
            temperature: 0.3, top_p: 0.9, max_tokens: 512, seed: 7, stop: ['x'],
            presence_penalty: 0.1, frequency_penalty: 0.2,
        });
    });

    it('top_k 는 vLLM 확장으로 그대로 전달된다 (게이트웨이 수용 확인됨)', () => {
        expect(applyOptionsToRequest({ top_k: 40 }).top_k).toBe(40);
    });

    it('0 같은 falsy 값도 누락하지 않는다', () => {
        const p = applyOptionsToRequest({ temperature: 0, frequency_penalty: 0, repeat_penalty: 0 });
        expect(p.temperature).toBe(0);
        expect(p.frequency_penalty).toBe(0);
        expect(p.repetition_penalty).toBe(0);
    });
});
