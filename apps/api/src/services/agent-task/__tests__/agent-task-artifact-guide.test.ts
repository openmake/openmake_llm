/**
 * 에이전트 작업 시스템 프롬프트 — 아티팩트 가이드의 "산출물 전달" 절 충돌 회귀 (2026-10-14).
 *
 * 채팅 턴용 절("산출물은 응답 아티팩트로 직접, MCP create_artifact·위임 금지")이 에이전트 작업
 * 프롬프트에도 주입돼, 같은 프롬프트의 "완성본을 open-design::create_artifact 로 저장" 지시와
 * 정면으로 부딪혔다. 에이전트 작업은 파일 산출(샌드박스 write)·디자인 저장이 본업이므로 그 절은
 * 채팅 턴에만 싣는다.
 */
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../chat-service/memory-policy', () => ({ resolveMemoryLearning: jest.fn().mockResolvedValue(false) }));
jest.mock('../task-learning', () => ({ buildLearningBlock: jest.fn().mockResolvedValue('') }));
jest.mock('../../../runtime-ports/skill-runtime', () => ({
    getSkillRuntime: () => ({ buildManifestPrompt: jest.fn().mockResolvedValue(null), buildProceduralSkillBlock: jest.fn().mockResolvedValue('') }),
}));

import { buildAgentTaskSystemContent } from '../skill-block';

describe('buildAgentTaskSystemContent — 아티팩트 가이드 주입', () => {
    it('아티팩트 가이드는 싣되 채팅 전용 "산출물 전달" 절은 빼서 open-design 저장 지시와 충돌하지 않는다', async () => {
        const content = await buildAgentTaskSystemContent('guest', '회사 소개 랜딩 페이지를 html 로 만들어줘', 't1');
        expect(content).toContain('📦 Artifacts');
        expect(content).not.toContain('산출물 전달');
        expect(content).not.toContain('백그라운드 작업 위임으로 대신 만들지 마세요');
        // 에이전트 작업 프롬프트 자체의 저장 지시는 그대로
        expect(content).toContain('open-design::create_artifact');
    });
});
