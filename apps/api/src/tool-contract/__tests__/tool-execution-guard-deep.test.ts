/**
 * detectDangerousArgsDeep — 중첩 인자(객체·배열)의 문자열 값에도 위험 인자 룰을 적용한다(E6).
 * 룰은 detectDangerousArg 그대로(가장 가까운 속성 이름 기준), 반환 key 는 점·대괄호 경로.
 */
import { detectDangerousArgsDeep } from '../tool-execution-guard';
import { TOOL_ARG_SCAN_LIMITS } from '../../config/runtime-limits';

describe('detectDangerousArgsDeep', () => {
    it('배열 안 객체의 위험 인자를 찾아 경로를 돌려준다', () => {
        expect(detectDangerousArgsDeep({ a: { b: [{ command: 'rm -rf / && true' }] } }))
            .toEqual({ key: 'a.b[0].command', violation: 'shell' });
    });

    it('배열 원소는 부모 속성 이름으로 룰을 고른다', () => {
        expect(detectDangerousArgsDeep({ a: { cmd: ['ls', 'rm -rf /; true'] } }))
            .toEqual({ key: 'a.cmd[1]', violation: 'shell' });
    });

    it('최상위 문자열도 검사한다(종전 최상위 검사와 같은 결과)', () => {
        expect(detectDangerousArgsDeep({ url: 'file:///etc/passwd' })).toEqual({ key: 'url', violation: 'URL scheme' });
    });

    it('path 인자를 주면 경로 앞에 붙인다', () => {
        expect(detectDangerousArgsDeep({ sql: 'DROP TABLE x' }, 'args')).toEqual({ key: 'args.sql', violation: 'SQL' });
    });

    it('위험 패턴이 없으면 null', () => {
        expect(detectDangerousArgsDeep({ a: { b: 'hello' } })).toBeNull();
        expect(detectDangerousArgsDeep({ a: { command: 'ls -la' }, n: 1, f: null, t: true })).toBeNull();
        expect(detectDangerousArgsDeep('rm -rf /;')).toBeNull();
        expect(detectDangerousArgsDeep(undefined)).toBeNull();
    });

    it('순환 참조 입력에서 throw 하지 않고 나머지를 계속 검사한다', () => {
        const cyclic: Record<string, unknown> = { a: {} };
        (cyclic.a as Record<string, unknown>).self = cyclic;
        const list: unknown[] = [];
        list.push(list);
        expect(() => detectDangerousArgsDeep(cyclic)).not.toThrow();
        expect(detectDangerousArgsDeep(cyclic)).toBeNull();
        expect(detectDangerousArgsDeep({ list })).toBeNull();
        (cyclic.a as Record<string, unknown>).cmd = 'a | b';
        expect(detectDangerousArgsDeep(cyclic)).toEqual({ key: 'a.cmd', violation: 'shell' });
    });

    it(`깊이 ${TOOL_ARG_SCAN_LIMITS.MAX_DEPTH} 까지 검사하고 그보다 깊은 곳은 내려가지 않는다`, () => {
        const nest = (levels: number): Record<string, unknown> => {
            let v: Record<string, unknown> = { cmd: 'x; y' };
            for (let i = 0; i < levels; i++) v = { n: v };
            return v;
        };
        const max = TOOL_ARG_SCAN_LIMITS.MAX_DEPTH;
        // cmd 문자열의 깊이 = 감싼 단계 + 1
        expect(detectDangerousArgsDeep(nest(max - 1))).toEqual({ key: `${'n.'.repeat(max - 1)}cmd`, violation: 'shell' });
        expect(detectDangerousArgsDeep(nest(max))).toBeNull();
        expect(() => detectDangerousArgsDeep(nest(100_000))).not.toThrow();
    });
});
