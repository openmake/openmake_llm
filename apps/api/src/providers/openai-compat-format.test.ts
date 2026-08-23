/**
 * 외부 provider 구조화 요청 — json_schema 를 실제로 실어 보내는지 고정.
 *
 * 배경(실측 2026-08-23): 외부 경로가 format 을 무시해 프롬프트만으로 JSON 을 받았고,
 * chatgpt:gpt-5.6-luna 가 required 필드(intent·sections)를 빠뜨려 검증 2회 실패 → degrade 했다.
 * 스키마를 모델에 강제해야 한다.
 */
import { toResponseFormat } from '../llm/stream-parser';
import { STRUCTURED_ANSWER_FORMAT } from '../schemas/structured-answer.schema';

describe('구조화 응답 포맷 변환', () => {
    it('FormatOption → OpenAI response_format(json_schema, strict)', () => {
        const rf = toResponseFormat(STRUCTURED_ANSWER_FORMAT) as {
            type: string;
            json_schema: { strict: boolean; schema: { required: string[] } };
        };
        expect(rf.type).toBe('json_schema');
        expect(rf.json_schema.strict).toBe(true);
        // required 가 실려야 모델이 intent·sections 를 빠뜨리지 않는다.
        expect(rf.json_schema.schema.required).toEqual(
            expect.arrayContaining(['intent', 'title', 'conclusion', 'sections', 'confidence']),
        );
    });

    it("'json' 단축형은 json_object 로", () => {
        expect(toResponseFormat('json')).toEqual({ type: 'json_object' });
    });

    it('미지정이면 undefined — 요청 body 에 response_format 을 넣지 않는다', () => {
        expect(toResponseFormat(undefined)).toBeUndefined();
    });
});
