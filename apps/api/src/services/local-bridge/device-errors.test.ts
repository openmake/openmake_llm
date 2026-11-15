/**
 * 디바이스 오류 판정 — 미지원 kind 접두가 디바이스 코어 적합성 fixture 와 맞는지 고정한다.
 * 코어(TS core.ts·Rust core.rs) 문구가 바뀌면 이 테스트가 깨져 서버 판정(code_nav 폴백 여부)을 함께 고치게 한다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRIDGE_UNSUPPORTED_KIND_PREFIX, BRIDGE_INVALID_REGEX_PREFIX, isUnsupportedKindError } from './device-errors';

interface FixtureRequest { msg: { kind?: unknown; folder?: string }; expect: { ok: boolean; error?: string } }
interface Fixture { cases: { id: string; requests: FixtureRequest[] }[] }

const FIXTURE = resolve(__dirname, '../../../../../packages/local-bridge-core/conformance/file-kinds.json');
const CODE_NAV_FIXTURE = resolve(__dirname, '../../../../../packages/local-bridge-core/conformance/code-nav.json');

describe('isUnsupportedKindError', () => {
    it('적합성 fixture 의 미지원 kind 응답은 모두 이 접두로 시작한다', () => {
        const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
        const unsupported = fixture.cases.flatMap((c) => c.requests)
            .filter((r) => r.msg.kind === 'evil_rpc' && r.msg.folder === undefined);
        expect(unsupported.length).toBeGreaterThan(0);
        for (const r of unsupported) {
            expect(r.expect.ok).toBe(false);
            expect(r.expect.error?.startsWith(BRIDGE_UNSUPPORTED_KIND_PREFIX)).toBe(true);
            expect(isUnsupportedKindError(r.expect.error ?? '')).toBe(true);
        }
    });

    it('요청 오류 문구는 미지원으로 보지 않는다', () => {
        expect(isUnsupportedKindError('지원하지 않는 kind: code_nav')).toBe(true);
        expect(isUnsupportedKindError('지원하지 않는 code_nav op: x')).toBe(false);
        expect(isUnsupportedKindError('정규식이 올바르지 않습니다: (')).toBe(false);
        expect(isUnsupportedKindError('')).toBe(false);
    });
});

describe('BRIDGE_INVALID_REGEX_PREFIX', () => {
    it('적합성 fixture(code-nav)의 정규식 구문 오류 접두와 같다', () => {
        const fixture = JSON.parse(readFileSync(CODE_NAV_FIXTURE, 'utf8')) as { cases: { requests: { msg: { op?: string }; expect: { errorPrefix?: string } }[] }[] };
        const prefixes = fixture.cases.flatMap((c) => c.requests)
            .filter((r) => r.msg.op === 'grep' && r.expect.errorPrefix !== undefined)
            .map((r) => r.expect.errorPrefix);
        expect(prefixes.length).toBeGreaterThan(0);
        for (const p of prefixes) expect(p).toBe(BRIDGE_INVALID_REGEX_PREFIX);
    });
});
