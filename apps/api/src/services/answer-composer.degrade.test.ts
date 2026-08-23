/**
 * 구조화 답변 degrade 경로 — json_schema 미지원·스키마 불일치에서 422 로 죽지 않게 한다.
 *
 * 배경: 이전엔 ① 백엔드가 response_format 을 거절하면 예외가 그대로 전파되고
 * ② 2회 시도 후 스키마가 어긋나면 무조건 422 였다. 모델/백엔드를 바꾸면 구조화 엔드포인트가
 * 통째로 죽는 셈이라, 답을 주는 쪽으로 degrade 한다(사유는 결과에 표기).
 */
import { composeStructuredAnswer } from './answer-composer';

const VALID = JSON.stringify({
    intent: 'explanation', title: 'T', conclusion: 'C', summary: 'S',
    sections: [{ heading: 'H', body: 'B' }], confidence: 'high',
});

describe('composeStructuredAnswer — degrade', () => {
    it('정상 경로는 degraded 를 남기지 않는다', async () => {
        const r = await composeStructuredAnswer({ message: '설명해줘', chat: async () => VALID });
        expect(r.structured.title).toBe('T');
        expect(r.degraded).toBeUndefined();
    });

    it('백엔드가 json_schema 를 거절하면 스키마 없이 재시도한다 (format_unsupported)', async () => {
        const calls: Array<boolean> = [];
        const r = await composeStructuredAnswer({
            message: '설명해줘',
            chat: async (_m, format) => {
                calls.push(!!format);
                if (format) throw new Error('400 BadRequestError: response_format json_schema is not supported');
                return VALID;
            },
        });
        expect(calls).toEqual([true, false]);   // 포맷 시도 → 포맷 없이 재호출
        expect(r.degraded).toBe('format_unsupported');
        expect(r.structured.title).toBe('T');
    });

    it('포맷과 무관한 오류는 그대로 전파한다 (오진 방지)', async () => {
        await expect(composeStructuredAnswer({
            message: '설명해줘',
            chat: async () => { throw new Error('ECONNREFUSED upstream down'); },
        })).rejects.toThrow(/ECONNREFUSED/);
    });

    it('2회 스키마 실패 후 평문을 최소 구조로 감싸 반환한다 (schema_invalid)', async () => {
        let n = 0;
        const r = await composeStructuredAnswer({
            message: '서울 인구를 알려줘',
            chat: async () => { n += 1; return n <= 2 ? '이건 JSON 이 아님' : '서울 인구는 약 940만 명입니다.'; },
        });
        expect(n).toBe(3);                       // 시도 2회 + 평문 1회
        expect(r.degraded).toBe('schema_invalid');
        expect(r.structured.conclusion).toContain('940만');
        expect(r.structured.confidence).toBe('low');   // 검증 미통과를 정직하게 표기
        expect(r.markdown).toContain('940만');
    });

    it('평문 fallback 마저 비어 있으면 422 로 실패한다', async () => {
        await expect(composeStructuredAnswer({
            message: 'x', chat: async () => '  ',
        })).rejects.toMatchObject({ statusCode: 422 });
    });
});
