/**
 * 동기화 런타임 — 플래그 OFF 면 tick·"지금 동기화" 모두 외부 호출 0, 호스트 타이머만 쓴다, 정지 후엔 돌지 않는다.
 */
const settings: Record<string, string | undefined> = {};
jest.mock('../../../config/env', () => ({ ...jest.requireActual('../../../config/env'), readSettingValue: (k: string) => settings[k] }));
const getState = jest.fn();
jest.mock('../../../runtime-ports/db-access', () => ({ getPool: () => ({ query: (...a: unknown[]) => getState(...a) }) }));
const safeFetch = jest.fn();
jest.mock('../../../runtime-ports/outbound-http', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));

import type { AddonRuntimeHost } from '../../../addon-host';
import { REGISTRY_SYNC_FLAG } from '../registry/constants';
import { resetRegistryRuntimeForTest, startRegistryRuntime, triggerRegistrySync } from '../registry/runtime';

function fakeHost() {
    const timers: Array<{ kind: string; fn: () => void; ms: number }> = [];
    const host = {
        owner: { addonId: 'extension-marketplace', version: '1.0.0', source: 'builtin' },
        registerCapabilities: jest.fn(),
        signal: new AbortController().signal,
        registerDisposable: jest.fn(),
        setInterval: (fn: () => void, ms: number) => { timers.push({ kind: 'interval', fn, ms }); return {} as NodeJS.Timeout; },
        setTimeout: (fn: () => void, ms: number) => { timers.push({ kind: 'timeout', fn, ms }); return {} as NodeJS.Timeout; },
    } as unknown as AddonRuntimeHost;
    return { host, timers };
}

beforeEach(() => {
    jest.clearAllMocks();
    resetRegistryRuntimeForTest();
    delete settings[REGISTRY_SYNC_FLAG];
});

describe('registry runtime', () => {
    it('플래그 OFF(기본) — tick 이 돌아도 외부 요청·DB 조회 0', async () => {
        const { host, timers } = fakeHost();
        await startRegistryRuntime(host);
        expect(timers.map(t => t.kind).sort()).toEqual(['interval', 'timeout']);
        for (const t of timers) t.fn();
        expect(await triggerRegistrySync({ force: true })).toEqual({ status: 'disabled' });
        await new Promise(r => setImmediate(r));
        expect(safeFetch).not.toHaveBeenCalled();
        expect(getState).not.toHaveBeenCalled();
    });

    it('플래그 ON — SSRF 가드 포트로 요청한다(레지스트리 오류는 던지지 않는다)', async () => {
        settings[REGISTRY_SYNC_FLAG] = 'true';
        getState.mockResolvedValue({ rows: [], rowCount: 1 });
        safeFetch.mockRejectedValue(new Error('SSRF blocked'));
        const r = await triggerRegistrySync({ force: true });
        expect(r).toMatchObject({ status: 'failed' });
        expect(safeFetch).toHaveBeenCalledTimes(1);
        expect(String(safeFetch.mock.calls[0][0])).toMatch(/^https:\/\/registry\.modelcontextprotocol\.io\/v0\.1\/servers\?/);
    });

    it('정지 뒤에는 플래그가 켜져 있어도 돌지 않는다, resume 하면 다시 돈다', async () => {
        settings[REGISTRY_SYNC_FLAG] = 'true';
        const { host } = fakeHost();
        const handle = await startRegistryRuntime(host);
        await handle.stop({ drain: false, signal: new AbortController().signal });
        expect(handle.health?.().status).toBe('stopped');
        expect(await triggerRegistrySync({ force: true })).toEqual({ status: 'disabled' });
        expect(safeFetch).not.toHaveBeenCalled();
        await handle.resume?.();
        expect(handle.health?.().status).toBe('running');
    });
});
