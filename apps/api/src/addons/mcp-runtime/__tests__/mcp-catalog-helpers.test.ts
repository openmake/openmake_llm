/**
 * renderArgs / assertCatalogArgValue — 카탈로그 인자 값 검증(E5).
 * 사용자가 `--key=value` 값에 옵션 모양(`-x`)·공백·제어문자를 실어 보내지 못하게 한다.
 */
import { assertCatalogArgValue, renderArgs } from '../data/mcp-catalog-helpers';

const template = {
    id: 'mcp-x',
    transport_type: 'stdio',
    command_template: 'npx -y some-mcp',
    args_schema: {},
    env_schema: {},
    is_enabled: true,
} as never;

describe('renderArgs — 인자 값 검증(E5)', () => {
    it('정상 값은 --key=value 로 렌더한다', () => {
        expect(renderArgs(template, { port: '8080' })).toEqual(['-y', 'some-mcp', '--port=8080']);
    });

    it('숫자·불리언은 String(v) 로 렌더한다', () => {
        expect(renderArgs(template, { port: 8080, verbose: true })).toEqual(['-y', 'some-mcp', '--port=8080', '--verbose=true']);
    });

    it('공백이 든 값은 거부한다', () => {
        expect(() => renderArgs(template, { token: 'a b' })).toThrow('잘못된 인자 값: token');
    });

    it('- 로 시작하는 값은 거부한다', () => {
        expect(() => renderArgs(template, { p: '-x' })).toThrow('잘못된 인자 값: p');
    });

    it('음수(- 로 시작하는 렌더 결과)도 거부한다', () => {
        expect(() => renderArgs(template, { n: -1 })).toThrow('잘못된 인자 값: n');
    });

    it('객체 값은 거부한다', () => {
        expect(() => renderArgs(template, { o: { a: 1 } })).toThrow('잘못된 인자 값: o');
    });

    it('stdio 가 아닌 템플릿은 args 를 렌더하지 않는다(검증 대상 아님)', () => {
        const sse = { ...(template as object), transport_type: 'sse' } as never;
        expect(renderArgs(sse, { q: 'a b' })).toEqual([]);
    });
});

describe('assertCatalogArgValue', () => {
    it.each([
        ['tab', 'a\tb'],
        ['newline', 'a\nb'],
        ['NUL', 'a\u0000b'],
        ['ESC', 'a\u001bb'],
    ])('제어문자·공백(%s)을 거부한다', (_label, v) => {
        expect(() => assertCatalogArgValue('k', v)).toThrow('잘못된 인자 값: k');
    });

    it('길이 512 는 통과, 513 은 거부한다', () => {
        expect(assertCatalogArgValue('k', 'a'.repeat(512))).toBe('a'.repeat(512));
        expect(() => assertCatalogArgValue('k', 'a'.repeat(513))).toThrow('잘못된 인자 값: k');
    });

    it.each([null, undefined, ['a'], () => 1])('문자열·숫자·불리언이 아닌 값(%p)을 거부한다', (v) => {
        expect(() => assertCatalogArgValue('k', v)).toThrow('잘못된 인자 값: k');
    });

    it('정상 값은 렌더 문자열을 돌려준다', () => {
        expect(assertCatalogArgValue('k', 'kr')).toBe('kr');
        expect(assertCatalogArgValue('k', 3)).toBe('3');
        expect(assertCatalogArgValue('k', false)).toBe('false');
    });

    it('라우트가 400 으로 매핑하는 McpCatalogInputError 로 던진다', () => {
        expect(() => assertCatalogArgValue('k', '-x')).toThrow(expect.objectContaining({ name: 'McpCatalogInputError' }));
    });
});
