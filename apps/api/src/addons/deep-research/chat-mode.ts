/**
 * deep-research add-on — 채팅 모드 (2026-09-19). 자율 다단계 리서치로 종합 보고서를 만든다.
 * 종전 ChatService.processMessageWithDeepResearch 의 본문이다.
 *
 * @module addons/deep-research/chat-mode
 */
import type { ChatModeExtension } from '../../services/chat-service/chat-modes';
import { formatResearchResult } from './format';
import type { ResearchProgress } from './service';
import { DeepResearchStrategy } from './strategy';

const strategy = new DeepResearchStrategy();

export const deepResearchChatMode: ChatModeExtension = {
    id: 'deep-research',
    label: 'DeepResearch',
    legacyRequestFlag: 'deepResearchMode',
    availableOverRest: false,
    progressEventType: 'research_progress',
    // REST /api/research 와 같은 역할 배정을 먼저 따른다(외부로 해석될 때만).
    modelRole: 'research',
    // 리서치 파이프라인은 message 만 쓴다 — 자체 검색·스크래핑이 URL 을 다루고 첨부 컨텍스트는 소비하지 않는다.
    // 첨부는 무음 폐기 대신 명시 거부한다(첨부가 반영된 것처럼 보이는 UX 기만 방지, 2026-06-13).
    inputPolicy: {
        pdfVision: false,
        urlPreanalysis: false,
        reuseAttachContext: false,
        rejectFileAttachmentsMessage: '딥 리서치 모드에서는 파일 첨부를 지원하지 않습니다. 첨부를 제거하거나 일반 채팅으로 질문해 주세요.',
    },

    // 다출처 수집 도구를 쓰려는 모델에게, 다단계 리서치는 이 모드가 맡는다는 것을 알린다
    relatedToolHints: { research_topic: ' 심층 다단계 리서치가 필요하면 deep research 모드를 사용하세요.' },

    async run({ req, client, onToken, onProgress }) {
        const result = await strategy.execute({
            req,
            client,
            onProgress: onProgress as ((progress: ResearchProgress) => void) | undefined,
            formatResearchResult: (researchResult) => formatResearchResult(researchResult),
            onToken,
        });
        return result.response;
    },
};
