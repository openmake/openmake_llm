/**
 * MCP-3 전송·엔드포인트 퇴역 안내 — 규칙 표·SSE 관례 후보·플래그 OFF 무변화.
 */
import { computeTransportNotice, transportNoticeFields, MCP_TRANSPORT_NOTICES_FLAG, ENDPOINT_NOTICE_RULES } from '../transport-notices';
import { mcpRuntimeContributions } from '../contributions';

/** addon-host/pack-catalog 의 CATALOG_SUPERSEDE_MIGRATE_FLAG 와 같은 값(add-on 테스트는 호스트를 import 하지 않는다) */
const CATALOG_SUPERSEDE_MIGRATE_FLAG = 'MCP_CATALOG_SUPERSEDE_MIGRATE';

const withFlag = (value: string | undefined, fn: () => void) => {
    const before = process.env[MCP_TRANSPORT_NOTICES_FLAG];
    try {
        if (value === undefined) delete process.env[MCP_TRANSPORT_NOTICES_FLAG]; else process.env[MCP_TRANSPORT_NOTICES_FLAG] = value;
        fn();
    } finally {
        if (before === undefined) delete process.env[MCP_TRANSPORT_NOTICES_FLAG]; else process.env[MCP_TRANSPORT_NOTICES_FLAG] = before;
    }
};

describe('computeTransportNotice', () => {
    it('Atlassian v1 은 전송과 무관하게 v2 이동 + 재로그인 안내', () => {
        for (const url of ['https://mcp.atlassian.com/v1/mcp', 'https://MCP.atlassian.com/v1/sse/', 'https://mcp.atlassian.com/v1/mcp?x=1']) {
            expect(computeTransportNotice({ transportType: 'streamable-http', url })).toEqual({
                code: 'endpoint-moved', replacementUrl: 'https://mcp.atlassian.com/v2/mcp', replacementVerified: true,
                sunsetDate: '2027-03-01', reauthRequired: true,
            });
        }
        expect(computeTransportNotice({ transportType: 'streamable-http', url: 'https://mcp.atlassian.com/v2/mcp' })).toBeNull();
    });

    it('Notion SSE 는 종료일과 확인된 /mcp 주소', () => {
        expect(computeTransportNotice({ transportType: 'sse', url: 'https://mcp.notion.com/sse' })).toEqual({
            code: 'endpoint-sunset', replacementUrl: 'https://mcp.notion.com/mcp', replacementVerified: true,
            sunsetDate: '2027-02-23', reauthRequired: false,
        });
    });

    it('그 밖의 SSE 는 일반 경고 — /sse 면 /mcp 후보(미확인), 쿼리는 싣지 않는다', () => {
        expect(computeTransportNotice({ transportType: 'sse', url: 'https://mcp.linear.app/sse?token=secret' })).toEqual({
            code: 'deprecated-transport', replacementUrl: 'https://mcp.linear.app/mcp', replacementVerified: false,
            sunsetDate: null, reauthRequired: false,
        });
        expect(computeTransportNotice({ transportType: 'sse', url: 'https://example.com/events' })).toMatchObject({
            code: 'deprecated-transport', replacementUrl: null,
        });
        expect(computeTransportNotice({ transportType: 'sse', url: null })).toMatchObject({ code: 'deprecated-transport', replacementUrl: null });
    });

    it('stdio·Streamable HTTP 일반 서버와 깨진 주소는 안내 없음', () => {
        expect(computeTransportNotice({ transportType: 'stdio', url: null })).toBeNull();
        expect(computeTransportNotice({ transportType: 'streamable-http', url: 'https://mcp.linear.app/mcp' })).toBeNull();
        expect(computeTransportNotice({ transportType: 'streamable-http', url: 'https://{host}/mcp' })).toBeNull();
    });

    it('규칙 표의 대체 주소는 https 이고 날짜 형식이 맞다', () => {
        for (const r of ENDPOINT_NOTICE_RULES) {
            expect(r.replacementUrl.startsWith('https://')).toBe(true);
            expect(r.sunsetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });
});

describe('설정 기여 — MCP-3 두 플래그', () => {
    it('안내는 실시간, 카탈로그 이관은 재시작 필요 boolean 설정으로 등록된다', () => {
        const settings = mcpRuntimeContributions.settings ?? [];
        expect(settings.find(s => s.key === MCP_TRANSPORT_NOTICES_FLAG)).toMatchObject({ validate: 'boolean', requiresRestart: false, secret: false });
        expect(settings.find(s => s.key === CATALOG_SUPERSEDE_MIGRATE_FLAG)).toMatchObject({ validate: 'boolean', requiresRestart: true, secret: false });
    });
});

describe('transportNoticeFields — 플래그', () => {
    const sse = ['sse', 'https://mcp.notion.com/sse'] as const;

    it('플래그 OFF(미설정·false)면 빈 객체 — 응답 모양이 종전과 같다', () => {
        withFlag(undefined, () => expect(transportNoticeFields(...sse)).toEqual({}));
        withFlag('false', () => expect(transportNoticeFields(...sse)).toEqual({}));
    });

    it('플래그 ON 이면 해당 서버에만 transportNotice', () => {
        withFlag('true', () => {
            expect(transportNoticeFields(...sse).transportNotice?.code).toBe('endpoint-sunset');
            expect(transportNoticeFields('stdio', null)).toEqual({});
        });
    });
});
