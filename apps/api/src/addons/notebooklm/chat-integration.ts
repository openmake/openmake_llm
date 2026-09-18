/**
 * notebooklm add-on — 채팅 턴 통합 (2026-09-19).
 *
 * 컴포저에서 고정한 노트북을 LLM 전용 메시지 앞에 결정적으로 주입하고, 도구 노출 매칭에서 이 서버를
 * "언급된 것" 으로 취급하게 한다(접두는 LLM 전용 채널에만 실려 원문 message 에는 서버 이름이 없다).
 *
 * @module addons/notebooklm/chat-integration
 */
import type { ChatTurnIntegration } from '../../services/chat-service/turn-integrations';
import { buildNotebookContextPrefix } from './notebook-context';

/** tool-merger 의 서버 참조(depth) 매칭 키 — 설치된 MCP 서버 이름에 포함되는 문자열 */
const SERVER_REFERENCE = 'notebooklm';
const ADDON_ID = 'notebooklm';

export const notebooklmChatIntegration: ChatTurnIntegration = {
    id: ADDON_ID,
    // contextRefs 도입(2026-09-19) 전 클라이언트(iOS Kit·캐시된 구 웹)는 최상위 `notebook` 필드로 보낸다
    legacyWsContextField: 'notebook',
    enhancedMessagePrefix(req, language) {
        const ref = req.contextRefs?.[ADDON_ID];
        return ref ? buildNotebookContextPrefix(ref, language) : undefined;
    },
    mcpSelectionHint: (req) => (req.contextRefs?.[ADDON_ID] ? SERVER_REFERENCE : undefined),
};
