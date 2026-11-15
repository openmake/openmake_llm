/**
 * 로컬 주소로 가는 LLMClient 는 게이트웨이 Router 재시도를 끄는 헤더를 싣는다 — 앱 SDK 재시도(기본 2회)와 게이트웨이 Router 재시도(2회)가
 * 겹쳐 실패 한 번에 upstream 9회가 되던 것을 3회로(400 같은 재시도 무의미 오류는 1회로). 생성자에서 정하므로 createClient·직접 new·derive
 * 파생이 한 규칙이다. 외부 provider 클라이언트(quotaExempt)에는 싣지 않는다.
 */
import { GATEWAY_NO_RETRY_HEADERS } from '../gateway-headers';

const ctorArgs: Array<Record<string, unknown>> = [];
jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((opts: Record<string, unknown>) => { ctorArgs.push(opts); return {}; }),
}));

import { LLMClient, createClient } from '../client';

beforeEach(() => { ctorArgs.length = 0; });
const last = () => ctorArgs[ctorArgs.length - 1];

describe('LLMClient — 게이트웨이 Router 재시도 헤더', () => {
    it('로컬 클라이언트를 직접 new 로 만들면 헤더가 실린다', () => {
        new LLMClient({ model: 'm' });
        expect(last().defaultHeaders).toEqual(GATEWAY_NO_RETRY_HEADERS);
    });

    it('createClient 로컬 클라이언트와 derive 파생에도 헤더가 실린다', () => {
        const base = createClient({ model: 'm' });
        expect(last().defaultHeaders).toEqual(GATEWAY_NO_RETRY_HEADERS);
        base.derive({ timeout: 1000 });
        expect(ctorArgs).toHaveLength(2);
        expect(last().defaultHeaders).toEqual(GATEWAY_NO_RETRY_HEADERS);
    });

    it('외부 클라이언트(quotaExempt)에는 providerId 유무와 무관하게 싣지 않는다 — derive 파생도', () => {
        new LLMClient({ model: 'm', quotaExempt: true });
        expect(last().defaultHeaders).toBeUndefined();
        createClient({ model: 'm', quotaExempt: true, providerId: 'p1' }).derive({ timeout: 1000 });
        expect(ctorArgs).toHaveLength(3);
        expect(ctorArgs[1].defaultHeaders).toBeUndefined();
        expect(ctorArgs[2].defaultHeaders).toBeUndefined();
    });
});
