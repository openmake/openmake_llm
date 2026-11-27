/**
 * MCP-2 협상 방식 — 플래그 해석·탐지 타임아웃·서버별 판정 기억(prior) 규칙.
 */
const settings: Record<string, string | undefined> = {};
jest.mock('../../../config/env', () => ({ readSettingValue: (k: string) => settings[k] }));

import {
    MCP_LEGACY_PRIOR_TTL_MS,
    MCP_NEGOTIATION_PROBE_TIMEOUT_MS,
    MCP_PRIOR_CACHE_MAX_ENTRIES,
    __resetPriorCacheForTest,
    forgetVerdict,
    priorFor,
    rememberVerdict,
    resolveNegotiationMode,
    resolveProbeTimeoutMs,
    versionNegotiationOption,
} from '../protocol-negotiation';

beforeEach(() => {
    for (const k of Object.keys(settings)) delete settings[k];
    __resetPriorCacheForTest();
});

const legacyClient = { getProtocolEra: () => 'legacy' as const, getDiscoverResult: () => undefined };
const discover = { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, serverInfo: { name: 's', version: '1' } };
const modernClient = { getProtocolEra: () => 'modern' as const, getDiscoverResult: () => discover };

describe('resolveNegotiationMode', () => {
    it('미설정·모르는 값·대소문자 다른 값은 legacy', () => {
        expect(resolveNegotiationMode()).toBe('legacy');
        expect(resolveNegotiationMode('modern')).toBe('legacy');
        expect(resolveNegotiationMode('AUTO')).toBe('legacy');
        expect(resolveNegotiationMode('')).toBe('legacy');
    });
    it('auto 는 auto (앞뒤 공백 허용), 설정 계층에서 읽는다', () => {
        expect(resolveNegotiationMode(' auto ')).toBe('auto');
        settings.MCP_PROTOCOL_NEGOTIATION = 'auto';
        expect(resolveNegotiationMode()).toBe('auto');
    });
});

describe('resolveProbeTimeoutMs', () => {
    it('기본 5초, 범위 안 정수만 override', () => {
        expect(resolveProbeTimeoutMs()).toBe(MCP_NEGOTIATION_PROBE_TIMEOUT_MS);
        expect(resolveProbeTimeoutMs('2000')).toBe(2000);
        expect(resolveProbeTimeoutMs('100')).toBe(MCP_NEGOTIATION_PROBE_TIMEOUT_MS);
        expect(resolveProbeTimeoutMs('999999')).toBe(MCP_NEGOTIATION_PROBE_TIMEOUT_MS);
        expect(resolveProbeTimeoutMs('1.5')).toBe(MCP_NEGOTIATION_PROBE_TIMEOUT_MS);
        expect(resolveProbeTimeoutMs('abc')).toBe(MCP_NEGOTIATION_PROBE_TIMEOUT_MS);
    });
});

describe('versionNegotiationOption', () => {
    it('legacy 면 옵션 없음(키 자체를 넣지 않게), auto 면 탐지 타임아웃·재시도 0', () => {
        expect(versionNegotiationOption('legacy')).toBeUndefined();
        expect(versionNegotiationOption('auto', 1234)).toEqual({ mode: 'auto', probe: { timeoutMs: 1234, maxRetries: 0 } });
    });
});

describe('판정 기억(prior)', () => {
    it('auto 에서 탐지한 legacy·modern 판정을 다음 연결에 넘긴다', () => {
        rememberVerdict('a', 'auto', legacyClient, undefined);
        rememberVerdict('b', 'auto', modernClient, undefined);
        expect(priorFor('a', 'auto')).toEqual({ kind: 'legacy' });
        expect(priorFor('b', 'auto')).toEqual({ kind: 'modern', discover });
    });

    it('legacy 모드에서는 기억하지도, 넘기지도 않는다', () => {
        rememberVerdict('a', 'legacy', legacyClient, undefined);
        expect(priorFor('a', 'auto')).toBeUndefined();
        rememberVerdict('a', 'auto', legacyClient, undefined);
        expect(priorFor('a', 'legacy')).toBeUndefined();
    });

    it('구 방식 판정은 24시간이 지나면 버리고 다시 탐지한다(새 방식 판정은 만료 없음)', () => {
        const t0 = 1_000_000;
        rememberVerdict('a', 'auto', legacyClient, undefined, t0);
        rememberVerdict('b', 'auto', modernClient, undefined, t0);
        expect(priorFor('a', 'auto', t0 + MCP_LEGACY_PRIOR_TTL_MS)).toEqual({ kind: 'legacy' });
        expect(priorFor('a', 'auto', t0 + MCP_LEGACY_PRIOR_TTL_MS + 1)).toBeUndefined();
        expect(priorFor('a', 'auto', t0)).toBeUndefined();
        expect(priorFor('b', 'auto', t0 + 10 * MCP_LEGACY_PRIOR_TTL_MS)).toEqual({ kind: 'modern', discover });
    });

    it('prior 로 연결한 결과는 다시 기억하지 않는다 — 구 방식 판정 만료가 재연결로 미뤄지지 않게', () => {
        const t0 = 5_000;
        rememberVerdict('a', 'auto', legacyClient, undefined, t0);
        rememberVerdict('a', 'auto', legacyClient, { kind: 'legacy' }, t0 + MCP_LEGACY_PRIOR_TTL_MS);
        expect(priorFor('a', 'auto', t0 + MCP_LEGACY_PRIOR_TTL_MS + 1)).toBeUndefined();
    });

    it('era 를 알 수 없거나 modern 인데 discover 가 없으면 기억하지 않는다', () => {
        rememberVerdict('a', 'auto', { getProtocolEra: () => undefined }, undefined);
        rememberVerdict('b', 'auto', { getProtocolEra: () => 'modern', getDiscoverResult: () => undefined }, undefined);
        rememberVerdict('c', 'auto', { getProtocolEra: () => { throw new Error('x'); } }, undefined);
        expect(priorFor('a', 'auto')).toBeUndefined();
        expect(priorFor('b', 'auto')).toBeUndefined();
        expect(priorFor('c', 'auto')).toBeUndefined();
    });

    it('forgetVerdict 로 지우면 다음 연결은 다시 탐지한다', () => {
        rememberVerdict('a', 'auto', modernClient, undefined);
        forgetVerdict('a');
        expect(priorFor('a', 'auto')).toBeUndefined();
    });

    it('상한을 넘으면 가장 오래된 서버부터 버린다', () => {
        for (let i = 0; i <= MCP_PRIOR_CACHE_MAX_ENTRIES; i++) rememberVerdict(`s${i}`, 'auto', legacyClient, undefined);
        expect(priorFor('s0', 'auto')).toBeUndefined();
        expect(priorFor('s1', 'auto')).toEqual({ kind: 'legacy' });
        expect(priorFor(`s${MCP_PRIOR_CACHE_MAX_ENTRIES}`, 'auto')).toEqual({ kind: 'legacy' });
    });
});
