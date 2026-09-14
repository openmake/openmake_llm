/**
 * 채팅 사용자 확인 질문 도구(ask_user) — 모델이 산출물을 만들기 전에 사용자에게 되묻고 턴을 끝낸다.
 *
 * 일반 채팅엔 에이전트 작업의 ask_human 같은 HITL 대기가 없어, 모델이 본문으로 질문해도 생성이
 * 멈추지 않고(생성 중엔 입력창이 잠긴다) 스스로 가정해 진행했다. 이 도구는 스트림 안에서
 * 대기하지 않는다 — 호출되면 external-provider 루프가 도구를 실행하지 않고 질문을 답변 본문으로
 * 내보낸 뒤 턴을 종료하며, 사용자의 답은 다음 턴 history 로 이어진다(WS·UI·iOS 변경 없음).
 *
 * @module services/chat-service/ask-user
 */
import { CHAT_ASK_USER } from '../../config/runtime-limits';
import type { ToolDefinition } from '../../llm';

export const ASK_USER_TOOL_NAME = 'ask_user';

/** PURE: 아티팩트·보고서 의도 턴에 노출할 ask_user 도구 정의. */
export function buildAskUserTool(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: ASK_USER_TOOL_NAME,
            description: '요청이 모호해 결과물이 근본적으로 달라질 때(예: 어느 지역·어떤 형식·어떤 데이터인지) '
                + '산출물을 만들기 전에 사용자에게 확인합니다. 호출하면 이 답변은 질문으로 끝나고 사용자 답을 '
                + '받은 다음 턴에 이어서 작업합니다. ⚠️ 합리적 기본값으로 진행할 수 있으면 묻지 말고 기본값을 '
                + '명시한 채 진행하세요. 질문은 사용자 언어로, 한 번에 하나만, 선택지가 있으면 번호 목록으로 쓰세요. '
                + '사용자가 이미 답한 내용을 다시 묻지 마세요.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: '사용자에게 보여줄 질문 본문(선택지 포함, 사용자 언어)' },
                },
                required: ['question'],
            },
        },
    };
}

/** PURE: 도구 배치에서 ask_user 호출을 찾는다(질문이 비어 있으면 없는 것으로 — 일반 경로에서 오류 결과를 받는다). */
export function findAskUserCall<T extends { name: string; args: unknown }>(toolCalls: readonly T[]): T | undefined {
    return toolCalls.find((tc) => tc.name === ASK_USER_TOOL_NAME && formatAskUserQuestion(tc.args) !== '');
}

/** PURE: 인자에서 질문 본문을 꺼내 다듬는다 — 공백 정리·상한 절단. 문자열이 아니면 ''. */
export function formatAskUserQuestion(args: unknown): string {
    const raw = args && typeof args === 'object' ? (args as { question?: unknown }).question : undefined;
    if (typeof raw !== 'string') return '';
    const q = raw.trim();
    return q.length > CHAT_ASK_USER.MAX_CHARS ? `${q.slice(0, CHAT_ASK_USER.MAX_CHARS)}…` : q;
}
