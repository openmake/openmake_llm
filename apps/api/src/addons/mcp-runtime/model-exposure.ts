/**
 * MCP 서버 도구가 채팅 모델에 어떻게 보이는가 — 관리 화면의 "모델에 노출됨" 표시용.
 *
 * "연결됨" 과 "모델에 노출됨" 은 다르다. 채팅 턴마다 도구 목록은 이렇게 정해진다
 * (services/chat-service/tool-merger.ts selectUserMcpAutoOn):
 *   - 사용자 서버: 메시지가 서버를 언급하면 그 서버 도구를 상한(CHAT_USER_MCP_TOOL_CAP) 안에서 싣는다.
 *     CHAT_USER_MCP_BREADTH_SLOTS > 0 이면 언급 안 된 서버도 슬롯만큼 돌아가며 싣는다.
 *   - 그 밖의 도구(전역 서버 포함)는 mcp_list_tools / mcp_call 메타 도구로만 닿는다
 *     (MCP_PROGRESSIVE_DISCLOSURE_ENABLED, 기본 켜짐).
 * 턴마다 메시지에 따라 달라지므로 "이번 턴에 실렸다" 가 아니라 **어떤 조건에서 실리는가** 를 돌려준다.
 *
 * @module addons/mcp-runtime/model-exposure
 */
import { CHAT_USER_MCP_BREADTH_SLOTS, MCP_PROGRESSIVE_DISCLOSURE_ENABLED } from '../../config/runtime-limits-tools';

/**
 * - `auto`       언급이 없어도 매 턴 일부 도구가 자동으로 실린다(breadth 슬롯)
 * - `on_mention` 메시지가 서버를 언급하면 도구가 실린다 (그 밖엔 mcp_call 로 쓸 수 있으면 viaMetaTools)
 * - `on_demand`  직접 실리지 않고 mcp_list_tools / mcp_call 로만 쓸 수 있다
 * - `none`       모델이 쓸 수 없다 (reason 참고)
 */
type ExposureState = 'auto' | 'on_mention' | 'on_demand' | 'none';
type ExposureReason = 'disabled' | 'not_connected' | 'no_tools' | 'meta_tools_off';

export interface ModelExposure {
    state: ExposureState;
    reason?: ExposureReason;
    /** mcp_list_tools / mcp_call 로도 쓸 수 있는가 */
    viaMetaTools: boolean;
}

interface ExposureInput {
    enabled: boolean;
    /** 전역(관리자 등록) 서버 — 사용자 서버의 자동 노출 대상이 아니다 */
    isGlobal: boolean;
    connectionStatus: string;
    toolCount: number;
}

interface ExposurePolicy { breadthSlots: number; progressive: boolean }

const DEFAULT_POLICY: ExposurePolicy = {
    breadthSlots: CHAT_USER_MCP_BREADTH_SLOTS,
    progressive: MCP_PROGRESSIVE_DISCLOSURE_ENABLED,
};

/** PURE — 서버 상태와 노출 정책으로 노출 조건을 계산한다 */
export function describeModelExposure(s: ExposureInput, policy: ExposurePolicy = DEFAULT_POLICY): ModelExposure {
    const viaMetaTools = policy.progressive;
    if (!s.enabled) return { state: 'none', reason: 'disabled', viaMetaTools: false };
    if (s.connectionStatus !== 'connected' && s.connectionStatus !== 'degraded') {
        return { state: 'none', reason: 'not_connected', viaMetaTools: false };
    }
    if (s.toolCount <= 0) return { state: 'none', reason: 'no_tools', viaMetaTools: false };
    if (s.isGlobal) {
        return viaMetaTools ? { state: 'on_demand', viaMetaTools } : { state: 'none', reason: 'meta_tools_off', viaMetaTools };
    }
    return { state: policy.breadthSlots > 0 ? 'auto' : 'on_mention', viaMetaTools };
}

/** 목록 행 + 실시간 상태(없으면 끊김)로 계산 — routes/mcp.routes.ts 서버 목록용 */
export function exposureOfServer(
    server: { enabled?: boolean | null; visibility?: string | null },
    live: { status?: string; toolCount?: number } | undefined,
): ModelExposure {
    return describeModelExposure({
        enabled: server.enabled !== false,
        isGlobal: server.visibility === 'global',
        connectionStatus: live?.status || 'disconnected',
        toolCount: live?.toolCount || 0,
    });
}
