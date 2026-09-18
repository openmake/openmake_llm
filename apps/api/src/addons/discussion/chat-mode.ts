/**
 * discussion add-on — 채팅 모드 (2026-09-19). 여러 전문가 에이전트가 토론해 답을 만든다.
 * 종전 ChatService.processMessageWithDiscussion 의 본문이다.
 *
 * @module addons/discussion/chat-mode
 */
import type { ChatModeExtension } from '../../services/chat-service/chat-modes';
import type { DiscussionProgress } from './engine';
import { formatDiscussionResult } from './format';
import { DiscussionStrategy } from './strategy';

const strategy = new DiscussionStrategy();

export const discussionChatMode: ChatModeExtension = {
    id: 'discussion',
    label: 'Discussion',
    legacyRequestFlag: 'discussionMode',
    availableOverRest: true,
    progressEventType: 'discussion_progress',
    // 토론은 첨부·URL 컨텍스트를 그대로 쓴다. PDF vision 주입만 뺀다(특수 모드 공통).
    inputPolicy: { pdfVision: false, urlPreanalysis: true, reuseAttachContext: true },

    async run({ req, client, onToken, onProgress, abortSignal }) {
        const checkAborted = () => {
            if (abortSignal?.aborted) throw new Error('ABORTED');
        };
        const result = await strategy.execute({
            req,
            client,
            onProgress: onProgress as ((progress: DiscussionProgress) => void) | undefined,
            formatDiscussionResult: (discussionResult) => formatDiscussionResult(discussionResult, req.userLanguagePreference),
            onToken,
            abortSignal,
            checkAborted,
        });
        return result.response;
    },
};
