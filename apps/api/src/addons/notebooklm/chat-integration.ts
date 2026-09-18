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

export const notebooklmChatIntegration: ChatTurnIntegration = {
    id: 'notebooklm',
    enhancedMessagePrefix: (req, language) => (req.notebook ? buildNotebookContextPrefix(req.notebook, language) : undefined),
    mcpSelectionHint: (req) => (req.notebook ? SERVER_REFERENCE : undefined),
};
