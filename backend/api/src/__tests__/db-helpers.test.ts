/**
 * db-helpers.test.ts
 * toBool, fromBool, safeJsonParse 단위 테스트
 */

import { toBool, fromBool, safeJsonParse } from '../utils/db-helpers';

describe('toBool', () => {
    describe('null / undefined 처리', () => {
        test('null → false', () => {
            expect(toBool(null)).toBe(false);
        });

        test('undefined → false', () => {
            expect(toBool(undefined)).toBe(false);
        });
    });

    describe('boolean 입력은 그대로 반환', () => {
        test('true → true', () => {
            expect(toBool(true)).toBe(true);
        });

        test('false → false', () => {
            expect(toBool(false)).toBe(false);
        });
    });

    describe('integer 입력', () => {
        test('1 → true', () => {
            expect(toBool(1)).toBe(true);
        });

        test('0 → false', () => {
            expect(toBool(0)).toBe(false);
        });

        test('2 → false (1이 아니면 false)', () => {
            expect(toBool(2)).toBe(false);
        });

        test('-1 → false', () => {
            expect(toBool(-1)).toBe(false);
        });
    });
});

describe('fromBool', () => {
    test('true → 1', () => {
        expect(fromBool(true)).toBe(1);
    });

    test('false → 0', () => {
        expect(fromBool(false)).toBe(0);
    });

    test('null → 0', () => {
        expect(fromBool(null)).toBe(0);
    });

    test('undefined → 0', () => {
        expect(fromBool(undefined)).toBe(0);
    });
});

describe('safeJsonParse', () => {
    describe('빈/null 값 처리', () => {
        test('null → defaultValue 반환', () => {
            expect(safeJsonParse(null, [])).toEqual([]);
        });

        test('undefined → defaultValue 반환', () => {
            expect(safeJsonParse(undefined, {})).toEqual({});
        });

        test('빈 문자열 → defaultValue 반환', () => {
            expect(safeJsonParse('', 42)).toBe(42);
        });
    });

    describe('유효한 JSON 파싱', () => {
        test('JSON 객체 파싱', () => {
            expect(safeJsonParse('{"name":"Alice","age":30}', {})).toEqual({ name: 'Alice', age: 30 });
        });

        test('JSON 배열 파싱', () => {
            expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
        });

        test('JSON 숫자 파싱', () => {
            expect(safeJsonParse('42', 0)).toBe(42);
        });

        test('JSON boolean 파싱', () => {
            expect(safeJsonParse('true', false)).toBe(true);
        });

        test('JSON null 파싱', () => {
            expect(safeJsonParse('null', 'default')).toBe(null);
        });

        test('중첩 객체 파싱', () => {
            const json = '{"a":{"b":{"c":1}}}';
            expect(safeJsonParse(json, {})).toEqual({ a: { b: { c: 1 } } });
        });
    });

    describe('잘못된 JSON 처리', () => {
        test('잘못된 JSON 문자열 → defaultValue 반환', () => {
            expect(safeJsonParse('not-json', 'fallback')).toBe('fallback');
        });

        test('중괄호 미완성 JSON → defaultValue 반환', () => {
            expect(safeJsonParse('{invalid', null)).toBe(null);
        });

        test('단순 문자열 → defaultValue 반환', () => {
            expect(safeJsonParse('hello world', [])).toEqual([]);
        });
    });

    describe('타입 제네릭 동작', () => {
        test('배열 타입 기본값', () => {
            const result = safeJsonParse<string[]>('[\"a\",\"b\"]', []);
            expect(result).toEqual(['a', 'b']);
        });

        test('인터페이스 타입 파싱', () => {
            interface User { name: string; age: number }
            const result = safeJsonParse<User>('{"name":"Bob","age":25}', { name: '', age: 0 });
            expect(result.name).toBe('Bob');
            expect(result.age).toBe(25);
        });
    });
});
