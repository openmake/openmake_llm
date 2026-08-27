/**
 * AgentTaskService 입력 첨부 파일 주입 + 목표 미달성(goal_incomplete) 종료 판정 검증.
 *
 * ① 샌드박스 OFF: files 가 goal 메시지에 fileContext 로 주입되는지
 * ② 샌드박스 ON: files 가 workspace(uploads/)에 기록되고 goal 에 안내 목록이 붙는지
 * ③ 최종 답변에 [GOAL_INCOMPLETE] 마커가 있으면 completed 대신 failed(goal_incomplete)
 */

let capturedConversation: Array<{ role: string; content: string; images?: string[] }> = [];
let chatContent = 'final answer';
/** 다중 턴/judge 시나리오용 응답 큐 — 비어 있으면 chatContent 사용 */
let chatQueue: string[] = [];

const mockChat = jest.fn(async (conv: Array<{ role: string; content: string }>) => {
    capturedConversation = conv.map((m) => ({ ...m })); // 호출 시점 스냅샷(이후 push 로 변형됨)
    const content = chatQueue.length > 0 ? chatQueue.shift()! : chatContent;
    return { content, metrics: { prompt_tokens: 1, completion_tokens: 1 } };
});

jest.mock('../llm', () => {
    // role-client 가 client.derive({timeout}).chat(...) 로 체이닝하므로 derive 는 self 반환
    const client: Record<string, unknown> = { chat: mockChat };
    client.derive = jest.fn(() => client);
    return { createClient: jest.fn(() => client) };
});
jest.mock('../config/model-roles', () => ({
    ...jest.requireActual('../config/model-roles'),
    getModelForRole: () => 'test-model',
}));
jest.mock('../utils/event-bus', () => ({ emitAgentTaskProgress: jest.fn() }));
jest.mock('../services/PushService', () => ({ getPushService: () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }) }));

const updateAgentTask = jest.fn().mockResolvedValue(undefined);
jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getAgentTask: jest.fn().mockResolvedValue({ id: 't1', status: 'pending' }),
        updateAgentTask,
        addAgentTaskStep: jest.fn().mockResolvedValue(undefined),
        deleteAgentTaskSteps: jest.fn().mockResolvedValue(undefined),
    }),
}));
jest.mock('../mcp/unified-client', () => ({
    getUnifiedMCPClient: () => ({
        getToolRouter: () => ({ getLLMTools: jest.fn().mockResolvedValue([]) }),
        executeToolWithContext: jest.fn(),
    }),
}));
jest.mock('../agents/skill-manager', () => ({
    getSkillManager: () => ({
        buildManifestPrompt: jest.fn().mockResolvedValue(null),
        getActiveSkillBindings: jest.fn().mockResolvedValue([]),
    }),
}));

// 샌드박스 ON 테스트용 TaskRuntime 목 — 파일 기록 호출을 캡처.
const writeWorkspaceFile = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/task-sandbox/runtime', () => ({
    TaskRuntime: jest.fn().mockImplementation(() => ({
        containerName: 'c1',
        workspacePath: '/tmp/ws-t1',
        create: jest.fn().mockResolvedValue(undefined),
        cleanup: jest.fn().mockResolvedValue(undefined),
        listWorkspace: jest.fn().mockResolvedValue([]),
        writeWorkspaceFile,
        getLLMTools: () => [],
        isTaskTool: () => false,
        getPlanSnapshot: () => [],
        executeTaskTool: jest.fn(),
    })),
    toLLMTool: jest.fn(),
}));

import { AgentTaskService } from '../services/AgentTaskService';

const baseInput = {
    taskId: 't1',
    goal: '업로드한 자료를 분석해서 보고서를 작성해줘.',
    userId: 'u1',
    userRole: 'user' as const,
    maxTurns: 1,
};

function goalMessage(): string {
    return capturedConversation.find((m) => m.role === 'user')?.content ?? '';
}

describe('AgentTaskService 입력 첨부 파일', () => {
    beforeEach(() => {
        capturedConversation = [];
        chatContent = 'final answer';
        chatQueue = [];
        mockChat.mockClear();
        updateAgentTask.mockClear();
        writeWorkspaceFile.mockClear();
        process.env.TASK_SANDBOX_ENABLED = 'false';
    });

    it('샌드박스 OFF: files 내용이 goal 메시지에 fileContext 로 주입된다', async () => {
        await new AgentTaskService().execute({
            ...baseInput,
            files: [{ name: 'data.csv', type: 'text/csv', content: 'a,b\n1,2' }],
        });

        const goal = goalMessage();
        expect(goal).toContain('업로드한 자료를 분석해서');
        expect(goal).toContain('data.csv');
        expect(goal).toContain('a,b');
    });

    it('files 미지정 시 goal 메시지는 변형되지 않는다', async () => {
        await new AgentTaskService().execute(baseInput);
        expect(goalMessage()).toBe(baseInput.goal);
    });

    it('샌드박스 ON: files 가 uploads/ 에 기록되고 goal 에 안내 목록이 붙는다', async () => {
        process.env.TASK_SANDBOX_ENABLED = 'true';
        await new AgentTaskService().execute({
            ...baseInput,
            files: [
                { name: 'report.pdf', content: '추출된 본문 텍스트', extracted: true },
                { name: 'no-content.bin' }, // 추출 실패 — 기록 제외 + 목록에 표기
            ],
        });

        expect(writeWorkspaceFile).toHaveBeenCalledTimes(1);
        expect(writeWorkspaceFile).toHaveBeenCalledWith('uploads/report.pdf.txt', '추출된 본문 텍스트');
        const goal = goalMessage();
        expect(goal).toContain('업로드 파일');
        expect(goal).toContain('uploads/report.pdf.txt');
        expect(goal).toContain('no-content.bin');
        // fileContext(본문 직접 주입)가 아닌 workspace 경로 안내여야 한다
        expect(goal).not.toContain('추출된 본문 텍스트');
    });

    it('샌드박스 ON: 바이너리 원본(data)과 추출 텍스트가 uploads/ 에 병행 기록된다', async () => {
        process.env.TASK_SANDBOX_ENABLED = 'true';
        await new AgentTaskService().execute({
            ...baseInput,
            files: [{
                name: 'stats.xlsx',
                data: Buffer.from('xlsx-binary').toString('base64'),
                content: '추출 텍스트',
                extracted: true,
            }],
        });

        expect(writeWorkspaceFile).toHaveBeenCalledTimes(2);
        expect(writeWorkspaceFile).toHaveBeenCalledWith('uploads/stats.xlsx', expect.any(Buffer));
        expect(writeWorkspaceFile).toHaveBeenCalledWith('uploads/stats.xlsx.txt', '추출 텍스트');
        const binCall = writeWorkspaceFile.mock.calls.find((c) => c[0] === 'uploads/stats.xlsx');
        expect((binCall![1] as Buffer).toString('utf8')).toBe('xlsx-binary');
        const goal = goalMessage();
        expect(goal).toContain('uploads/stats.xlsx');
        expect(goal).toContain('uploads/stats.xlsx.txt');
    });

    it('최종 답변에 [GOAL_INCOMPLETE] 마커가 있으면 failed(goal_incomplete) 로 종료', async () => {
        chatContent = '[GOAL_INCOMPLETE]\n업로드된 자료가 없어 보고서를 작성할 수 없습니다.';
        await new AgentTaskService().execute(baseInput);

        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({
            status: 'failed',
            error: 'goal_incomplete',
        }));
        const failedCall = updateAgentTask.mock.calls.find((c) => c[1]?.status === 'failed');
        expect(failedCall![1].result).toContain('업로드된 자료가 없어');
        expect(failedCall![1].result).not.toContain('[GOAL_INCOMPLETE]');
        // completed 로 기록된 적이 없어야 한다
        expect(updateAgentTask.mock.calls.some((c) => c[1]?.status === 'completed')).toBe(false);
    });

    it('이미지: goal 메시지 vision 채널로 주입되고, 샌드박스 ON 이면 uploads/ 에도 기록', async () => {
        process.env.TASK_SANDBOX_ENABLED = 'true';
        const dataUrl = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
        await new AgentTaskService().execute({ ...baseInput, images: [dataUrl] });

        const userMsg = capturedConversation.find((m) => m.role === 'user');
        expect(userMsg?.images).toEqual([dataUrl]);
        expect(writeWorkspaceFile).toHaveBeenCalledWith('uploads/image_1.png', expect.any(Buffer));
        const call = writeWorkspaceFile.mock.calls.find((c) => c[0] === 'uploads/image_1.png');
        expect((call![1] as Buffer).toString('utf8')).toBe('png-bytes');
        expect(goalMessage()).toContain('uploads/image_1.png');
    });

    it('이미지: 샌드박스 OFF 여도 vision 채널 주입은 유지된다', async () => {
        const dataUrl = `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}`;
        await new AgentTaskService().execute({ ...baseInput, images: [dataUrl] });

        const userMsg = capturedConversation.find((m) => m.role === 'user');
        expect(userMsg?.images).toEqual([dataUrl]);
        expect(writeWorkspaceFile).not.toHaveBeenCalled();
    });

    it('judge 미달성 판정 시 마커 없이도 failed(goal_incomplete) 로 종료', async () => {
        // 턴0=계획(재촉) → 턴1=마커 없는 "수행 불가" 최종 답변 → judge 호출 → 미달성
        chatQueue = [
            '1. 자료 확인 2. 분석 3. 보고서 작성 계획입니다.',
            '업로드된 자료가 없어 보고서를 작성할 수 없습니다. 다시 업로드해 주세요.',
            '{"achieved": false, "reason": "필요한 입력 자료가 없어 수행하지 못함"}',
        ];
        await new AgentTaskService().execute({ ...baseInput, maxTurns: 3 });

        expect(mockChat).toHaveBeenCalledTimes(3); // 본 루프 2회 + judge 1회
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({
            status: 'failed',
            error: 'goal_incomplete',
        }));
        expect(updateAgentTask.mock.calls.some((c) => c[1]?.status === 'completed')).toBe(false);
    });

    it('judge 달성 판정 시 completed 유지', async () => {
        chatQueue = [
            '분석 계획입니다.',
            '요청하신 보고서입니다: 핵심 지표는 다음과 같습니다...',
            '{"achieved": true, "reason": "보고서 본문을 작성함"}',
        ];
        await new AgentTaskService().execute({ ...baseInput, maxTurns: 3 });

        expect(mockChat).toHaveBeenCalledTimes(3);
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'completed' }));
        expect(updateAgentTask.mock.calls.some((c) => c[1]?.status === 'failed')).toBe(false);
    });

    it('아티팩트가 있는 최종 답변은 판정을 적용하지 않고 completed — 셰도우는 기록만', async () => {
        chatQueue = [
            '<artifact id="report" kind="markdown" title="보고서">본문</artifact> 보고서를 작성했습니다.',
            // 셰도우 판정이 미달성이어도 완료를 뒤집지 않는다(적용 조건은 아티팩트 0 그대로).
            '{"achieved": false, "reason": "목표와 무관한 산출물"}',
        ];
        await new AgentTaskService().execute(baseInput);

        expect(mockChat).toHaveBeenCalledTimes(2); // 본 루프 1회 + 셰도우 judge 1회
        expect(updateAgentTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'completed' }));
        expect(updateAgentTask.mock.calls.some((c) => c[1]?.status === 'failed')).toBe(false);
    });
});
