/**
 * 자체 tools 경로(OpenAI 호환 클라이언트가 tools 를 넘기는 요청) — 클라이언트 중단 가드.
 *
 * #1296 은 채팅 파이프라인(external-provider)에서 중단 뒤 진행을 막았지만, 이 경로는
 * ChatService 를 우회해 LLM 호출 뒤 그대로 응답을 저장·반환했다(잘린 본문·부분 tool_calls).
 * 같은 관례로 LLM 호출 뒤 신호가 중단이면 'ABORTED' 를 던진다. 로컬 호출엔 신호도 전달한다.
 */
const mockProcess = jest.fn();
const mockSave = jest.fn();

jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../request-persistence', () => ({
    saveAssistantMessage: (...args: unknown[]) => mockSave(...args),
}));

import { handleToolCallingPath } from '../tool-calling-path';
import * as toolCalling from '../external-tool-calling';

const tools = [{ type: 'function' as const, function: { name: 'read_file', description: '', parameters: { type: 'object' as const, properties: {} } } }];

function params(abortSignal: AbortSignal) {
    return {
        message: '파일 읽어줘', tools, client: { model: 'local-model' } as never,
        userContext: { userRole: 'user' } as never, sessionId: 's1', auditUserId: 'u1',
        persistContent: true, plan: {} as never, startTime: Date.now(), onToken: () => {}, abortSignal,
    };
}

describe('handleToolCallingPath — 클라이언트 중단', () => {
    beforeEach(() => {
        mockSave.mockReset();
        mockProcess.mockReset();
        jest.spyOn(toolCalling, 'processExternalToolCalling').mockImplementation((...a) => mockProcess(...a));
    });
    afterEach(() => jest.restoreAllMocks());

    it('LLM 호출 뒤 신호가 중단이면 응답을 저장·반환하지 않고 ABORTED 를 던진다', async () => {
        const controller = new AbortController();
        mockProcess.mockImplementation(async () => {
            controller.abort();
            return { response: '잘린', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{' } }], finish_reason: 'tool_calls' };
        });

        await expect(handleToolCallingPath(params(controller.signal))).rejects.toThrow('ABORTED');
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('중단이 없으면 종전대로 저장하고 tool_calls 를 돌려준다', async () => {
        mockProcess.mockResolvedValue({ response: '', tool_calls: [], finish_reason: 'stop' });
        const r = await handleToolCallingPath(params(new AbortController().signal));
        expect(r.finish_reason).toBe('stop');
        expect(mockSave).toHaveBeenCalledTimes(1);
    });
});

describe('processExternalToolCalling — 로컬 호출에 중단 신호 전달', () => {
    it('client.chat 의 advancedOptions.signal 로 abortSignal 을 넘긴다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '안녕' });
        const controller = new AbortController();
        await toolCalling.processExternalToolCalling({
            message: '안녕', tools, client: { chat } as never, onToken: () => {}, abortSignal: controller.signal,
        } as never);
        expect(chat.mock.calls[0][3]).toMatchObject({ signal: controller.signal });
    });
});
