/** done.cleanedContent — 오케스트레이터 내부 표식이 최종본에서 정리된 턴은 화면 본문을 교체한다 */
import { resolveCleanedContent } from '../ws-chat-completion';

describe('resolveCleanedContent — 오케스트레이터 내부 표식', () => {
    it('스트리밍 본문의 표식이 최종본에서 정리됐으면 최종본을 돌려준다', () => {
        expect(resolveCleanedContent({ artifactCount: 0, streamedResponse: '맑음 [오케스트레이터 작업 결과 t1, 결과 6]', finalResponse: '맑음' })).toBe('맑음');
    });

    it('표식이 없던 턴은 교체하지 않는다', () => {
        expect(resolveCleanedContent({ artifactCount: 0, streamedResponse: '맑음 [출처 6]', finalResponse: '맑음 [출처 6]' })).toBeUndefined();
    });
});
