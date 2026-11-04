/**
 * POST /api/chat 디버그 pipeline_info(관리자 + x-omk-debug) — 호환 기간(PR-H1-1)에는 중립 필드 `mode`
 * (요청에서 켜진 활성 모드 id, 없으면 null)를 더하고 구 필드 `discussion` 은 그대로 둔다.
 * 인증·rate limit 미들웨어를 거치지 않도록 라우터 스택에서 핸들러를 꺼내 가짜 req/res 로 직접 호출한다.
 */
import type { Request, Response } from 'express';

jest.mock('../../llm/client', () => ({
    createClient: jest.fn(() => ({ model: 'test-model', chat: jest.fn() })),
}));

import chatRouter from '../../routes/chat.routes';
import { ChatRequestHandler } from '../../chat/request-handler';
import { __setChatModesForTest, DEFAULT_INPUT_POLICY, type ChatModeExtension } from '../../services/chat-service/chat-modes';

const MODE: ChatModeExtension = {
    id: 'mode-r', label: 'Mode R', availableOverRest: true, legacyRequestFlag: 'modeRFlag', progressEventType: 'mode_r_progress',
    inputPolicy: { ...DEFAULT_INPUT_POLICY, pdfVision: false }, run: async () => '',
};

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }> } };
const postHandler = () => {
    const layer = (chatRouter as unknown as { stack: Layer[] }).stack.find((l) => l.route?.path === '/' && l.route.methods.post);
    if (!layer?.route) throw new Error('POST / 라우트를 찾지 못했다');
    return layer.route.stack[layer.route.stack.length - 1].handle;
};

async function invoke(body: Record<string, unknown>, role = 'admin') {
    jest.spyOn(ChatRequestHandler, 'resolveUserContextFromRequest').mockReturnValue({ userId: 'guest', userRole: role } as never);
    jest.spyOn(ChatRequestHandler, 'processChat').mockResolvedValue({
        response: '답', sessionId: 's1', model: 'm1',
        executionPlan: { requestedModel: 'm1', resolvedEngine: 'e', executionStrategy: 'single', thinkingLevel: 'off', useDiscussion: false },
    } as never);
    const req = { body: { message: 'hi', ...body }, headers: { 'x-omk-debug': 'true' } } as unknown as Request;
    const json = jest.fn();
    const res = { once: jest.fn(), status: jest.fn().mockReturnThis(), json } as unknown as Response;
    await postHandler()(req, res);
    return json.mock.calls[0][0].data as Record<string, any>;
}

beforeEach(() => __setChatModesForTest([MODE]));
afterEach(() => { __setChatModesForTest(null); jest.restoreAllMocks(); });

describe('POST /api/chat — 디버그 pipeline_info.mode', () => {
    it('modes 로 켠 모드 id 가 mode 로 나오고 discussion 은 그대로다', async () => {
        const data = await invoke({ modes: { 'mode-r': true } });
        expect(data.pipeline_info).toMatchObject({ mode: 'mode-r', discussion: false });
    });

    it('구 불리언 필드로 켜도 같은 mode 가 나온다', async () => {
        const data = await invoke({ modeRFlag: true });
        expect(data.pipeline_info.mode).toBe('mode-r');
    });

    it('켜진 모드가 없으면 mode 는 null 이다', async () => {
        const data = await invoke({});
        expect(data.pipeline_info).toHaveProperty('mode', null);
        expect(data.pipeline_info.discussion).toBe(false);
    });

    it('관리자가 아니면 pipeline_info 자체가 없다(회귀)', async () => {
        const data = await invoke({ modes: { 'mode-r': true } }, 'user');
        expect(data.pipeline_info).toBeUndefined();
    });
});
