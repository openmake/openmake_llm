/**
 * MCP 런타임의 채팅 턴 통합 — 진행적 공개 메타 도구 노출 (2026-09-19).
 *
 * 종전에는 Base 의 `chat-tool-selection` 이 `MCP_META_TOOL_NAMES` 를 직접 always-on 목록에 넣었다.
 * 도구 이름과 노출 조건은 이 add-on 의 것이므로 Base 확장점(`forceIncludeTools`)으로 옮겼다.
 * 훅은 순수 함수다 — 프롬프트 지문·평가 하네스가 이 결과에 의존한다.
 *
 * @module addons/mcp-runtime/chat-integration
 */
import type { ChatTurnIntegration } from '../../services/chat-service/turn-integrations';
import { MCP_PROGRESSIVE_DISCLOSURE_ENABLED, MCP_RESOURCE_INTENT_PATTERNS, CHAT_TOOL_INTENT_GATE_ENABLED } from '../../config/runtime-limits';
import { MCP_META_TOOL_NAMES, MCP_RESOURCE_META_TOOL_NAMES } from './mcp-meta-tools';

export const mcpRuntimeChatIntegration: ChatTurnIntegration = {
    id: 'mcp-runtime',
    /**
     * 메타 도구는 플래그가 켜져 있으면 상시, resources/prompts 메타 도구(F13.2)는 의도 턴에만
     * (상시 노출은 프롬프트 팽창 — 게이트 OFF 면 의도 판정 없이 포함).
     */
    forceIncludeTools(message: string) {
        if (!MCP_PROGRESSIVE_DISCLOSURE_ENABLED) return [];
        const resourceWanted = !CHAT_TOOL_INTENT_GATE_ENABLED || MCP_RESOURCE_INTENT_PATTERNS.some((re) => re.test(message));
        const names = [...MCP_META_TOOL_NAMES, ...(resourceWanted ? MCP_RESOURCE_META_TOOL_NAMES : [])];
        return names.map(name => ({ nameIncludes: name, reason: 'mcp-progressive-disclosure' }));
    },
};
