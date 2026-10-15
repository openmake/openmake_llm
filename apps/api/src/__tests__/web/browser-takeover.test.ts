/** 브라우저 넘겨받기 입력 변환(apps/web/lib/browser-takeover.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {}; // 모듈로 만들어 다른 테스트 파일의 전역 타입 이름과 겹치지 않게 한다
type Input = { op: 'type'; text: string } | { op: 'key'; key: string } | null;
interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }
type InputErrorKind = 'blocked' | 'unresolved' | 'timeout' | 'unknown';
const { toViewportPoint, keyToInput, classifyInputError } = require('../../../../web/lib/browser-takeover') as {
    toViewportPoint: (cx: number, cy: number, rect: { left: number; top: number; width: number; height: number },
        natural: { width: number; height: number }) => { x: number; y: number } | null;
    keyToInput: (e: KeyLike) => Input;
    classifyInputError: (raw: string) => InputErrorKind;
};

describe('toViewportPoint', () => {
    const natural = { width: 1280, height: 800 };
    it('줄여서 보여 준 화면의 클릭을 원래 화면 좌표로 바꾼다', () => {
        expect(toViewportPoint(100 + 320, 50 + 200, { left: 100, top: 50, width: 640, height: 400 }, natural)).toEqual({ x: 640, y: 400 });
    });
    it('가장자리는 화면 안으로 맞춘다', () => {
        expect(toViewportPoint(100 + 640, 50 + 400, { left: 100, top: 50, width: 640, height: 400 }, natural)).toEqual({ x: 1280, y: 800 });
        expect(toViewportPoint(99, 49, { left: 100, top: 50, width: 640, height: 400 }, natural)).toEqual({ x: 0, y: 0 });
    });
    it('화면이 아직 없으면 null', () => {
        expect(toViewportPoint(1, 1, { left: 0, top: 0, width: 0, height: 0 }, natural)).toBeNull();
        expect(toViewportPoint(1, 1, { left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toBeNull();
    });
});

describe('keyToInput', () => {
    it('글자는 입력으로', () => {
        expect(keyToInput({ key: 'a' })).toEqual({ op: 'type', text: 'a' });
        expect(keyToInput({ key: ' ' })).toEqual({ op: 'type', text: ' ' });
        expect(keyToInput({ key: '@' })).toEqual({ op: 'type', text: '@' });
    });
    it('특수 키는 키 누름으로', () => {
        expect(keyToInput({ key: 'Enter' })).toEqual({ op: 'key', key: 'Enter' });
        expect(keyToInput({ key: 'Backspace' })).toEqual({ op: 'key', key: 'Backspace' });
        expect(keyToInput({ key: 'ArrowDown' })).toEqual({ op: 'key', key: 'ArrowDown' });
    });
    it('Ctrl/Cmd 조합은 Control 조합으로(세션은 리눅스 브라우저)', () => {
        expect(keyToInput({ key: 'a', ctrlKey: true })).toEqual({ op: 'key', key: 'Control+a' });
        expect(keyToInput({ key: 'v', metaKey: true })).toEqual({ op: 'key', key: 'Control+v' });
    });
    it('한글 조합 중·수식 키 단독·모르는 키는 보내지 않는다', () => {
        expect(keyToInput({ key: 'ㅎ', isComposing: true })).toBeNull();
        expect(keyToInput({ key: 'Process' })).toBeNull();
        expect(keyToInput({ key: 'Shift' })).toBeNull();
        expect(keyToInput({ key: 'F5' })).toBeNull();
        expect(keyToInput({ key: '+', ctrlKey: true })).toBeNull();
    });
});

describe('classifyInputError', () => {
    it('프록시가 연결을 거절하면 blocked(허용 목록 밖 도메인)', () => {
        expect(classifyInputError('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://example.net/\nCall log:\n  - navigating to "https://example.net/", waiting until "domcontentloaded"')).toBe('blocked');
        expect(classifyInputError('page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://example.net/')).toBe('blocked');
    });
    it('이름 풀이 실패는 unresolved', () => {
        expect(classifyInputError('page.goto: net::ERR_NAME_NOT_RESOLVED at https://exmaple.com/')).toBe('unresolved');
    });
    it('시간 초과는 timeout', () => {
        expect(classifyInputError('Timeout 20000ms exceeded')).toBe('timeout');
        expect(classifyInputError('page.goto: net::ERR_TIMED_OUT at https://example.com/')).toBe('timeout');
        expect(classifyInputError('page.goto: net::ERR_CONNECTION_TIMED_OUT at https://example.com/')).toBe('timeout');
    });
    it('대소문자를 가리지 않는다', () => {
        expect(classifyInputError('net::err_tunnel_connection_failed')).toBe('blocked');
        expect(classifyInputError('NET::ERR_NAME_NOT_RESOLVED')).toBe('unresolved');
        expect(classifyInputError('timeout 5000ms exceeded')).toBe('timeout');
    });
    it('그 외는 unknown', () => {
        expect(classifyInputError('Element is not attached to the DOM')).toBe('unknown');
        expect(classifyInputError('')).toBe('unknown');
    });
});
