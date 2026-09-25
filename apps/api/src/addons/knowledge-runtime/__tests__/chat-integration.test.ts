/**
 * 채팅 턴 통합 — 격리 규칙(사용자 확정): 일반 Chat 은 프로젝트 존재를 모르고, DB 로 연결된 대화만 그 프로젝트를 검색한다.
 * - 비연결 대화: 검색 안 함(retrieve 미호출), 전역 메모리 쓰기 허용(격리 아님)
 * - 연결 대화: 연결된 spaceId 만 검색(다른 space 는 절대 검색 안 함), 소유자 지침·메모리를 systemPromptPart 로 주입, 격리 세션
 */
import type { TurnContextInput } from '../../../services/chat-service/turn-integrations';
import { SPACE_INSTRUCTIONS_TAG, SPACE_MEMORY_TAG } from '../prompts';

jest.mock('../conversations/binding-service', () => ({
    resolveBoundSpace: jest.fn(),
    sessionHasBinding: jest.fn(),
    listBoundSessionIdsForUser: jest.fn(),
}));
jest.mock('../config/scope-policy', () => ({
    actorFor: jest.fn(async () => ({ userId: 'u1', activeOrg: null, orgWriteRoles: [] })),
}));
jest.mock('../spaces/repository', () => ({ touchSpace: jest.fn(async () => undefined) }));
jest.mock('../retrieval/service', () => ({ retrieve: jest.fn() }));
jest.mock('../config/profiles', () => ({
    resolveSpaceProfiles: jest.fn(async () => ({
        limits: { maxInstructionTokens: 2000, maxMemoryTokens: 1500, maxMemoryItems: 100, maxMemoryCharsPerItem: 2000 },
    })),
}));
jest.mock('../memories/repository', () => ({ listMemoryRows: jest.fn(async () => []) }));

import { knowledgeChatIntegration } from '../chat-integration';
import * as binding from '../conversations/binding-service';
import * as retrieval from '../retrieval/service';
import * as memRepo from '../memories/repository';

const resolveBoundSpace = binding.resolveBoundSpace as jest.Mock;
const sessionHasBinding = binding.sessionHasBinding as jest.Mock;
const listBoundSessionIdsForUser = binding.listBoundSessionIdsForUser as jest.Mock;
const retrieve = retrieval.retrieve as jest.Mock;
const listMemoryRows = memRepo.listMemoryRows as jest.Mock;

const input = (over: Partial<TurnContextInput> = {}): TurnContextInput => ({
    userId: 'u1', sessionId: 'sess1', message: 'q', userLang: 'ko', sourceOffset: 0, ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    retrieve.mockResolvedValue({ contextBlock: 'CTX', sources: [{ n: 1, title: 't', url: '/x', snippet: 's' }], hadEvidence: true });
    listMemoryRows.mockResolvedValue([]);
});

describe('prepareTurnContext — 연결 여부에 따른 검색', () => {
    it('(a) 비연결 대화: retrieve 를 호출하지 않고 아무 컨텍스트도 주지 않는다', async () => {
        resolveBoundSpace.mockResolvedValue(null);
        const r = await knowledgeChatIntegration.prepareTurnContext!(input());
        expect(r).toBeUndefined();
        expect(retrieve).not.toHaveBeenCalled();
    });

    it('(b) 연결 대화: 연결된 spaceId 만 검색한다(다른 space 는 검색하지 않는다)', async () => {
        resolveBoundSpace.mockResolvedValue({ spaceId: 'sA', name: 'A', icon: null, instructions: null, configProfileId: null });
        const r = await knowledgeChatIntegration.prepareTurnContext!(input());
        expect(retrieve).toHaveBeenCalledTimes(1);
        expect(retrieve.mock.calls[0][0].spaceIds).toEqual(['sA']);
        expect(retrieve.mock.calls[0][0].spaceIds).not.toContain('sB');
        expect(r?.contextBlock).toBe('CTX');
        expect(r?.sources).toHaveLength(1);
    });

    it('(e) 연결 해제 후에는 다시 비연결처럼 검색하지 않는다', async () => {
        resolveBoundSpace.mockResolvedValueOnce({ spaceId: 'sA', name: 'A', icon: null, instructions: null, configProfileId: null });
        await knowledgeChatIntegration.prepareTurnContext!(input());
        expect(retrieve).toHaveBeenCalledTimes(1);
        resolveBoundSpace.mockResolvedValueOnce(null); // unbind 됨
        const r2 = await knowledgeChatIntegration.prepareTurnContext!(input());
        expect(r2).toBeUndefined();
        expect(retrieve).toHaveBeenCalledTimes(1); // 추가 호출 없음
    });

    it('연결 대화: 소유자 지침·메모리를 systemPromptPart 로 주입한다(연결된 경우만)', async () => {
        resolveBoundSpace.mockResolvedValue({ spaceId: 'sA', name: 'A', icon: null, instructions: '항상 표로 답하라', configProfileId: null });
        listMemoryRows.mockResolvedValue([{ id: 'm1', content: '팀 규칙: 존댓말', created_at: '', updated_at: '' }]);
        const r = await knowledgeChatIntegration.prepareTurnContext!(input());
        expect(r?.systemPromptPart).toContain(`<${SPACE_INSTRUCTIONS_TAG}>`);
        expect(r?.systemPromptPart).toContain('항상 표로 답하라');
        expect(r?.systemPromptPart).toContain(`<${SPACE_MEMORY_TAG}>`);
        expect(r?.systemPromptPart).toContain('팀 규칙: 존댓말');
    });

    it('연결 대화지만 지침·메모리가 없으면 systemPromptPart 는 undefined', async () => {
        resolveBoundSpace.mockResolvedValue({ spaceId: 'sA', name: 'A', icon: null, instructions: null, configProfileId: null });
        const r = await knowledgeChatIntegration.prepareTurnContext!(input());
        expect(r?.systemPromptPart).toBeUndefined();
    });
});

describe('메모리 격리·목록 숨김 훅', () => {
    it('(c) 연결된 세션은 격리 세션(전역 메모리 미기록)', async () => {
        sessionHasBinding.mockResolvedValue(true);
        expect(await knowledgeChatIntegration.isMemoryIsolatedSession!('u1', 'sess1')).toBe(true);
        sessionHasBinding.mockResolvedValue(false);
        expect(await knowledgeChatIntegration.isMemoryIsolatedSession!('u1', 'sess2')).toBe(false);
    });

    it('숨김 세션 목록은 사용자의 연결 세션 id 를 그대로 준다', async () => {
        listBoundSessionIdsForUser.mockResolvedValue(['s1', 's2']);
        expect(await knowledgeChatIntegration.listHiddenSessionIds!('u1')).toEqual(['s1', 's2']);
    });
});
