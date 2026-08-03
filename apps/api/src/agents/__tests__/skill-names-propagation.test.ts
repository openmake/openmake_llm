/**
 * 스킬 이름 전파 회귀 테스트 (2026-08-02).
 *
 * 결함: buildManifestPrompt 가 프롬프트 문자열만 돌려주고 어떤 스킬이 주입됐는지는
 * 버렸다. legacy fallback 경로에서만 skillNames 를 채웠는데 운영은 manifest 경로만
 * 타므로(실측 21/21 manifest, 0 legacy), getAgentSystemMessage 의 skillNames 가
 * 항상 비었고 onSkillsActivated 콜백이 한 번도 호출되지 않았다 —
 * 프론트의 "스킬 활성화" 표시가 뜨지 않고 어떤 스킬이 붙었는지 관측할 수 없었다.
 *
 * 수정: manifest 경로도 skillNames 를 돌려주고 호출부가 이를 전파한다.
 */
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const buildManifestPrompt = jest.fn();
const getSkillsForAgent = jest.fn().mockResolvedValue([]);
const buildSkillPrompt = jest.fn().mockResolvedValue('');
jest.mock('../skill-manager', () => ({
    getSkillManager: () => ({ buildManifestPrompt, getSkillsForAgent, buildSkillPrompt }),
}));

import { getAgentSystemMessage } from '../system-prompt';
import type { AgentSelection } from '../index';

const selection = { primaryAgent: 'software-engineer', category: 'technology', phase: 'planning' } as AgentSelection;

describe('getAgentSystemMessage — 스킬 이름 전파', () => {
    beforeEach(() => { buildManifestPrompt.mockReset(); });

    it('manifest 경로에서 주입된 스킬 이름을 돌려준다', async () => {
        buildManifestPrompt.mockResolvedValue({
            prompt: '\n\n## 적용된 스킬 (manifest)\n<skill_context name="s1">내용</skill_context>',
            skillNames: ['소프트웨어 엔지니어 전문 스킬'],
        });

        const r = await getAgentSystemMessage(selection, 'u1', 'ko');

        // 종전에는 프롬프트만 붙고 skillNames 가 [] 였다 — 그 회귀를 막는다.
        expect(r.skillNames).toEqual(['소프트웨어 엔지니어 전문 스킬']);
        expect(r.prompt).toContain('적용된 스킬 (manifest)');
    });

    it('manifest 가 없으면 스킬 이름도 비어 있다', async () => {
        buildManifestPrompt.mockResolvedValue(null);
        const r = await getAgentSystemMessage(selection, 'u1', 'ko');
        expect(r.skillNames).toEqual([]);
    });

    it('스킬 조회가 실패해도 프롬프트는 반환된다 (fail-open)', async () => {
        buildManifestPrompt.mockRejectedValue(new Error('DB down'));
        const r = await getAgentSystemMessage(selection, 'u1', 'ko');
        expect(r.prompt.length).toBeGreaterThan(0);
        expect(r.skillNames).toEqual([]);
    });
});
