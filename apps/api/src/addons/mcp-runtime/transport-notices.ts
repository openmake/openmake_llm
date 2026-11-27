/**
 * MCP 전송·엔드포인트 퇴역 안내 (MCP-3, 마켓플레이스 계획 v3.7 §2-1) — **표시만 한다**.
 *
 * 2026-07-28 사양이 HTTP+SSE 전송을 deprecated 로 돌렸고(SEP-2596), 몇몇 원격 서버는 엔드포인트를 옮기거나
 * 끈다. 연결 동작은 바꾸지 않는다 — SSE 서버도 지금처럼 연결된다(OpenAI·Google·xAI 가 SSE 를 계속 지원).
 * 서버 목록·설치 결과·카탈로그 응답에 `transportNotice` 하나를 덧붙여 화면이 경고·전환 안내를 띄우게 할 뿐이다.
 *
 * 플래그 `MCP_TRANSPORT_DEPRECATION_NOTICES`(기본 OFF, system_settings 실시간) — 꺼져 있으면 필드 자체가 없다
 * (응답 모양이 종전과 같다).
 *
 * @module addons/mcp-runtime/transport-notices
 */
import { readSettingValue } from '../../config/env';

export const MCP_TRANSPORT_NOTICES_FLAG = 'MCP_TRANSPORT_DEPRECATION_NOTICES';

export type TransportNoticeCode =
    /** 전송 자체가 deprecated(SSE) — 종료일은 서버마다 다르다 */
    | 'deprecated-transport'
    /** 이 엔드포인트가 정해진 날 꺼진다 */
    | 'endpoint-sunset'
    /** 서버가 새 주소로 옮겨 간다 — 옛 OAuth 등록(clientId·자격증명)은 새 주소에서 다시 해야 한다 */
    | 'endpoint-moved';

export interface TransportNotice {
    code: TransportNoticeCode;
    /** 옮겨 갈 Streamable HTTP 주소 — 모르면 null */
    replacementUrl: string | null;
    /** replacementUrl 이 서버 공식 안내로 확인된 값인가(false = `/sse` → `/mcp` 관례에서 나온 후보) */
    replacementVerified: boolean;
    /** 종료·이동일(YYYY-MM-DD) — 공지가 없으면 null */
    sunsetDate: string | null;
    /** 새 주소에서 OAuth 를 다시 등록·로그인해야 하는가(캐시된 clientId·`.well-known` 자격증명 무효) */
    reauthRequired: boolean;
}

interface EndpointRule {
    /** 규칙 식별(테스트·로그용) */
    id: string;
    /** 쿼리·프래그먼트를 뺀 `origin + pathname` 에 맞춘다 */
    pattern: RegExp;
    code: Exclude<TransportNoticeCode, 'deprecated-transport'>;
    replacementUrl: string;
    sunsetDate: string;
    reauthRequired: boolean;
}

/**
 * 공식 문서로 확인한 원격 서버 일정(2026-11-27). 새 공지가 나오면 여기에 한 줄 — 코드 분기 없음.
 *   - Atlassian: v1 서버가 2027-03-01 v2 로 이동, 호환되지 않는 클라이언트는 캐시된 clientId·`.well-known` 자격증명을 지워야 한다
 *   - Notion: SSE 엔드포인트 2027-02-23 종료, Streamable HTTP `/mcp`
 * Linear 는 SSE 를 "deprecated fallback" 으로 두고 종료일이 없어 일반 SSE 경고만 받는다.
 */
export const ENDPOINT_NOTICE_RULES: readonly EndpointRule[] = [
    {
        id: 'atlassian-v1',
        pattern: /^https:\/\/mcp\.atlassian\.com\/v1\/(mcp|sse)\/?$/i,
        code: 'endpoint-moved',
        replacementUrl: 'https://mcp.atlassian.com/v2/mcp',
        sunsetDate: '2027-03-01',
        reauthRequired: true,
    },
    {
        id: 'notion-sse',
        pattern: /^https:\/\/mcp\.notion\.com\/sse\/?$/i,
        code: 'endpoint-sunset',
        replacementUrl: 'https://mcp.notion.com/mcp',
        sunsetDate: '2027-02-23',
        reauthRequired: false,
    },
];

/** SSE 주소 관례(`…/sse`) — 같은 서버의 Streamable HTTP 는 보통 `…/mcp` 다. 확인된 값이 아니라 후보로만 낸다 */
const SSE_PATH_SUFFIX = /\/sse\/?$/i;
const STREAMABLE_PATH_SUFFIX = '/mcp';

function normalizedEndpoint(url: string | null | undefined): URL | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
    } catch {
        return null;
    }
}

/**
 * 서버(또는 카탈로그 템플릿)의 전송·주소로 안내를 계산한다. 해당 없음이면 null.
 * 순수 함수 — 플래그와 무관하다(플래그 판정은 `transportNoticeFields`).
 */
export function computeTransportNotice(input: { transportType: string | null | undefined; url: string | null | undefined }): TransportNotice | null {
    const u = normalizedEndpoint(input.url);
    const endpoint = u ? `${u.origin}${u.pathname}` : null;
    const rule = endpoint ? ENDPOINT_NOTICE_RULES.find(r => r.pattern.test(endpoint)) : undefined;
    if (rule) {
        return {
            code: rule.code,
            replacementUrl: rule.replacementUrl,
            replacementVerified: true,
            sunsetDate: rule.sunsetDate,
            reauthRequired: rule.reauthRequired,
        };
    }
    if (input.transportType !== 'sse') return null;
    const candidate = u && SSE_PATH_SUFFIX.test(u.pathname)
        ? `${u.origin}${u.pathname.replace(SSE_PATH_SUFFIX, STREAMABLE_PATH_SUFFIX)}`
        : null;
    return { code: 'deprecated-transport', replacementUrl: candidate, replacementVerified: false, sunsetDate: null, reauthRequired: false };
}

export function transportNoticesEnabled(): boolean {
    return readSettingValue(MCP_TRANSPORT_NOTICES_FLAG) === 'true';
}

/**
 * 응답 객체에 펼칠 필드 — 플래그가 꺼져 있거나 해당 없음이면 빈 객체(응답 모양 불변).
 * `{ ...server, ...transportNoticeFields(server.transport_type, server.url) }`
 */
export function transportNoticeFields(transportType: string | null | undefined, url: string | null | undefined): { transportNotice?: TransportNotice } {
    if (!transportNoticesEnabled()) return {};
    const notice = computeTransportNotice({ transportType, url });
    return notice ? { transportNotice: notice } : {};
}
