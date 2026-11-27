/**
 * MCP 협상 관측(MCP-1) — 기록값 추출·인증 분류·플래그·fail-open.
 */
const settings: Record<string, string | undefined> = {};
jest.mock('../../../config/env', () => ({ ...jest.requireActual('../../../config/env'), readSettingValue: (k: string) => settings[k] }));

import {
    extractNegotiationObservation, resolveAuthMethod, observeNegotiation, isNegotiationObserveEnabled,
    MCP_NEGOTIATION_OBSERVE_FLAG, NEGOTIATION_TEXT_MAX_CHARS, NEGOTIATION_LIST_MAX_ITEMS,
    type McpNegotiationObservation, type NegotiationSource,
} from '../negotiation-observer';
import { mcpRuntimeContributions } from '../contributions';

const cfg = { id: 'srv-1', name: 'fs', transport_type: 'streamable-http' as const };

const legacySource: NegotiationSource = {
    getServerCapabilities: () => ({
        tools: { listChanged: true }, resources: {}, prompts: undefined, logging: false,
        extensions: { 'io.modelcontextprotocol/apps': { version: '0.3' }, 'com.example/x': {} },
        experimental: { 'io.modelcontextprotocol/tasks': { secretToken: 'leak-me' } },
    }),
    getServerVersion: () => ({ name: 'demo-server', version: '1.2.3' }),
    getNegotiatedProtocolVersion: () => '2025-06-18',
    getProtocolEra: () => 'legacy',
};

afterEach(() => { delete settings[MCP_NEGOTIATION_OBSERVE_FLAG]; });

describe('extractNegotiationObservation', () => {
    it('전송·리비전·세대·capability 키·확장 id·serverInfo 를 뽑는다', () => {
        const o = extractNegotiationObservation(cfg, legacySource, 'none');
        expect(o).toEqual({
            serverId: 'srv-1',
            transport: 'streamable-http',
            authMethod: 'none',
            protocolEra: 'legacy',
            protocolVersion: '2025-06-18',
            sdkGeneration: 'v1-compatible',
            capabilities: ['experimental', 'extensions', 'resources', 'tools'],
            extensions: [
                { id: 'com.example/x' },
                { id: 'io.modelcontextprotocol/apps', version: '0.3' },
                { id: 'io.modelcontextprotocol/tasks' },
            ],
            serverName: 'demo-server',
            serverVersion: '1.2.3',
        });
    });

    it('확장 설정 값(서버가 보낸 임의 필드)은 저장하지 않는다', () => {
        const o = extractNegotiationObservation(cfg, legacySource, 'none');
        expect(JSON.stringify(o)).not.toContain('leak-me');
    });

    it('modern 협상은 v2 로 추정한다', () => {
        const o = extractNegotiationObservation(cfg, { getProtocolEra: () => 'modern', getNegotiatedProtocolVersion: () => '2026-07-28' }, 'none');
        expect(o.sdkGeneration).toBe('v2');
        expect(o.protocolEra).toBe('modern');
    });

    it('메서드가 없거나 던져도 빈 값으로 채운다', () => {
        const o = extractNegotiationObservation(cfg, { getServerVersion: () => { throw new Error('x'); } }, 'none');
        expect(o).toMatchObject({ protocolEra: null, protocolVersion: null, sdkGeneration: 'unknown', capabilities: [], extensions: [], serverName: null });
    });

    it('서버가 보낸 문자열·목록은 상한으로 자른다', () => {
        const many = Object.fromEntries(Array.from({ length: NEGOTIATION_LIST_MAX_ITEMS + 10 }, (_, i) => [`k${String(i).padStart(3, '0')}`, {}]));
        const o = extractNegotiationObservation(cfg, {
            getServerCapabilities: () => ({ ...many, extensions: many }),
            getServerVersion: () => ({ name: 'n'.repeat(NEGOTIATION_TEXT_MAX_CHARS + 50), version: 3 }),
        }, 'none');
        expect(o.serverName).toHaveLength(NEGOTIATION_TEXT_MAX_CHARS);
        expect(o.serverVersion).toBeNull();
        expect(o.capabilities).toHaveLength(NEGOTIATION_LIST_MAX_ITEMS);
        expect(o.extensions).toHaveLength(NEGOTIATION_LIST_MAX_ITEMS);
    });
});

describe('resolveAuthMethod', () => {
    const auth = (s: unknown, t: unknown, c: unknown) => ({
        staticClient: async () => s, tokens: async () => t, clientInformation: async () => c,
    });
    it('stdio·provider 없음은 none', async () => {
        expect(await resolveAuthMethod('stdio', auth({ clientId: 'x' }, {}, {}))).toBe('none');
        expect(await resolveAuthMethod('sse', undefined)).toBe('none');
    });
    it('사전 등록 > 토큰 없음 > DCR > 불명', async () => {
        expect(await resolveAuthMethod('streamable-http', auth({ clientId: 'x' }, undefined, undefined))).toBe('oauth-preregistered');
        expect(await resolveAuthMethod('streamable-http', auth(null, undefined, undefined))).toBe('oauth-not-required');
        expect(await resolveAuthMethod('streamable-http', auth(null, { access_token: 't' }, { client_id: 'c' }))).toBe('oauth-dynamic');
        expect(await resolveAuthMethod('streamable-http', auth(null, { access_token: 't' }, undefined))).toBe('oauth-unknown');
    });
});

describe('observeNegotiation', () => {
    const tokenAuth = { staticClient: async () => null, tokens: async () => ({ access_token: 'SECRET-TOKEN', refresh_token: 'SECRET-R' }), clientInformation: async () => ({ client_id: 'CID', client_secret: 'SECRET-C' }) };

    it('플래그 OFF(기본)면 저장 호출 0', async () => {
        const sink = { upsert: jest.fn(async () => undefined) };
        expect(isNegotiationObserveEnabled()).toBe(false);
        await observeNegotiation(cfg, legacySource, tokenAuth, sink);
        expect(sink.upsert).not.toHaveBeenCalled();
    });

    it('플래그 ON 이면 1회 저장하고 토큰·client_id·secret 은 싣지 않는다', async () => {
        settings[MCP_NEGOTIATION_OBSERVE_FLAG] = 'true';
        const saved: McpNegotiationObservation[] = [];
        await observeNegotiation(cfg, legacySource, tokenAuth, { upsert: async (o) => { saved.push(o); } });
        expect(saved).toHaveLength(1);
        expect(saved[0].authMethod).toBe('oauth-dynamic');
        const dump = JSON.stringify(saved[0]);
        for (const s of ['SECRET-TOKEN', 'SECRET-R', 'SECRET-C', 'CID']) expect(dump).not.toContain(s);
    });

    it('저장·인증 조회가 실패해도 reject 하지 않는다(fail-open)', async () => {
        settings[MCP_NEGOTIATION_OBSERVE_FLAG] = 'true';
        await expect(observeNegotiation(cfg, legacySource, undefined, { upsert: async () => { throw new Error('db down'); } })).resolves.toBeUndefined();
        const badAuth = { staticClient: async () => { throw new Error('kv'); }, tokens: async () => undefined, clientInformation: async () => undefined };
        await expect(observeNegotiation(cfg, legacySource, badAuth, { upsert: jest.fn() })).resolves.toBeUndefined();
    });
});

describe('플래그 등록', () => {
    it('add-on 기여 설정에 boolean·비시크릿·실시간 반영으로 등록돼 있다', () => {
        const def = mcpRuntimeContributions.settings?.find(s => s.key === MCP_NEGOTIATION_OBSERVE_FLAG);
        expect(def).toMatchObject({ secret: false, requiresRestart: false, validate: 'boolean' });
    });
});
