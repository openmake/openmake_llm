/**
 * verifiability → Stage 2 실행 전략 라벨(셰도우 would_route_to). 라벨은 Base 의 중립 이름이다(PR-H1-1) —
 * 특정 add-on 이름을 저장값으로 쓰지 않는다. 기존 행의 옛 라벨은 보존 기간(90일) 뒤 사라진다.
 */
import { verifiabilityToStrategy } from '../verifiability-classifier';

describe('verifiabilityToStrategy', () => {
    it('decomposable 은 중립 라벨 multi-source-research 로 기록된다', () => {
        expect(verifiabilityToStrategy('decomposable')).toBe('multi-source-research');
    });

    it('나머지 라벨은 그대로다', () => {
        expect(verifiabilityToStrategy('executable')).toBe('generate-verify');
        expect(verifiabilityToStrategy('factual')).toBe('conditional-verify');
        expect(verifiabilityToStrategy('none')).toBe('single');
    });
});
