/**
 * 명시적 아티팩트 요청 턴의 백그라운드 위임 억제 회귀 테스트 (2026-10-14).
 *
 * 배경: 운영 Discord 봇에서 "그걸 파일로 저장하면 되는거 아니야? 다시 작성해서 html 파일 하나로
 * 만들어줘" 가 위임 의도(`파일…저장`)에도 걸려 delegate_agent_task 가 노출됐고, 모델이 백그라운드
 * 작업으로 위임했다. REST 클라이언트(봇)는 백그라운드 작업 결과를 받을 통로가 없어 HTML 이 끝내
 * 전달되지 않았다. 아티팩트 의도 턴의 산출물은 응답 아티팩트로 직접 나와야 한다.
 */
import { buildExternalToolPlan } from '../external-tool-plan';
import { DELEGATE_AGENT_TASK_TOOL_NAME } from '../orchestration-dispatch';
import { getArtifactGuide } from '../../../prompts/artifact-guide';
import type { ChatMessageRequest } from '../../chat-service-types';
import type { ToolDefinition } from '../../../llm';

const webSearchTool: ToolDefinition = {
    type: 'function',
    function: { name: 'web_search', description: 'search', parameters: { type: 'object', properties: {} } },
};

const names = (message: string, req: Partial<ChatMessageRequest> = {}) => buildExternalToolPlan({
    allowedTools: [webSearchTool],
    toolCalling: true,
    orchestration: { contributedTools: [], taskDelegate: true },
    req: { message, ...req } as ChatMessageRequest,
}).tools.map((t) => t.function.name);

describe('buildExternalToolPlan — 아티팩트 의도가 위임 의도보다 우선', () => {
    it('아티팩트 의도와 위임 의도가 함께 있으면 delegate_agent_task 를 노출하지 않는다', () => {
        expect(names('그걸 파일로 저장하면 되는거 아니야? 다시 작성해서 html 파일 하나로 만들어줘'))
            .not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
        expect(names('엑셀 파일로 정리해줘', { artifactMode: true })).not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });

    it('위임 의도만 있으면 종전대로 노출한다', () => {
        expect(names('엑셀 파일로 매출 집계 만들어서 저장해줘')).toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });
});

describe('getArtifactGuide — 산출물은 응답 아티팩트로 직접', () => {
    it('MCP 생성 도구·백그라운드 위임으로 대신 만들지 말라고 안내한다', () => {
        expect(getArtifactGuide('ko')).toContain('백그라운드 작업 위임으로 대신 만들지 마세요');
        expect(getArtifactGuide('en')).toContain('do not build them through an MCP tool');
    });
});

describe('getArtifactGuide — 산출물 전달 절은 채팅 턴에만 (에이전트 작업 프롬프트와 충돌 분리)', () => {
    it('기본(채팅)은 산출물 전달 절과 디자인 워크스페이스 저장 제한을 싣는다', () => {
        expect(getArtifactGuide('ko')).toContain('산출물 전달 — 이 응답의 아티팩트로 직접');
        expect(getArtifactGuide('ko')).toContain('사용자가 명시적으로 요청할 때만 하세요');
        expect(getArtifactGuide('en')).toContain('Deliverable delivery — directly as this response');
        expect(getArtifactGuide('en')).toContain('only\nwhen the user explicitly asks');
    });

    it('deliverableClause:false 면 두 문장을 빼고 나머지 가이드는 유지한다 — 에이전트 작업은 파일·open-design 저장이 본업', () => {
        for (const lang of ['ko', 'en']) {
            const g = getArtifactGuide(lang, { deliverableClause: false });
            expect(g).not.toMatch(/산출물 전달|Deliverable delivery/);
            expect(g).not.toMatch(/백그라운드 작업 위임|delegating to a background task/);
            expect(g).not.toMatch(/명시적으로 요청할 때만|explicitly asks/);
            expect(g).not.toContain('create_artifact');
            // 디자인 컨텍스트 조회 안내·형식 규칙은 그대로
            expect(g).toContain('open-design::get_artifact');
            expect(g).toContain('kind="html"');
        }
    });

    it('buildArtifactGuideBlock 이 옵션을 그대로 전달한다', async () => {
        const { buildArtifactGuideBlock } = await import('../artifact-guide-block');
        expect(await buildArtifactGuideBlock('guest', 'ko')).toContain('산출물 전달');
        expect(await buildArtifactGuideBlock('guest', 'ko', { deliverableClause: false })).not.toContain('산출물 전달');
    });
});

describe('배정 안내 — 위임 도구가 숨겨진 턴엔 delegate_agent_task 를 설명하지 않는다', () => {
    const { buildOrchestrationPromptGuide } = jest.requireActual('../orchestration-dispatch') as typeof import('../orchestration-dispatch');
    const { buildExternalSystemPromptParts } = jest.requireActual('../external-system-prompt') as typeof import('../external-system-prompt');

    const systemPrompt = (message: string, req: Partial<ChatMessageRequest> = {}) => {
        const { staticParts, dynamicParts } = buildExternalSystemPromptParts({
            req: { message, ...req } as ChatMessageRequest,
            resolved: { fullId: 'test/model' } as never,
            ctx: {},
            orchestration: { contributedTools: [], taskDelegate: true },
        });
        return [...staticParts, ...dynamicParts].join('\n\n');
    };

    it('includeDelegate:false 면 위임 절을 뺀다', () => {
        expect(buildOrchestrationPromptGuide({ includeDelegate: false })).not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
        expect(buildOrchestrationPromptGuide({ includeDelegate: true })).toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });

    it('아티팩트 의도 턴의 시스템 프롬프트엔 delegate_agent_task 안내가 없다', () => {
        expect(systemPrompt('그걸 파일로 저장하면 되는거 아니야? 다시 작성해서 html 파일 하나로 만들어줘'))
            .not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
        expect(systemPrompt('엑셀 파일로 정리해줘', { artifactMode: true })).not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });

    it('위임 의도만 있는 턴엔 종전대로 안내한다', () => {
        expect(systemPrompt('엑셀 파일로 매출 집계 만들어서 저장해줘')).toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });
});
