import { toFormatOption } from '../local-response-format';

describe('toFormatOption', () => {
    it('json_object → "json"', () => {
        expect(toFormatOption({ type: 'json_object' })).toBe('json');
    });

    it('json_schema → FormatOption (properties·required·additionalProperties 보존)', () => {
        const rf = { type: 'json_schema', json_schema: { name: 'r', strict: true, schema: {
            type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false,
        } } };
        expect(toFormatOption(rf)).toEqual({
            type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false,
        });
    });

    it('변환 불가 형태는 undefined (호출자가 warn)', () => {
        expect(toFormatOption(undefined)).toBeUndefined();
        expect(toFormatOption({ type: 'text' })).toBeUndefined();
        expect(toFormatOption({ type: 'json_schema', json_schema: { schema: { type: 'array' } } })).toBeUndefined();
    });
});
