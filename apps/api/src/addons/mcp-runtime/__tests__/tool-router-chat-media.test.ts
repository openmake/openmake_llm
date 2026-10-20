import { scopedArtifactStore } from '../../../runtime-ports/artifact-store';
import { runWithToolMediaSink } from '../../../utils/tool-media-sink';
import { offloadMediaBlocks } from '../media-content';
import { ToolRouter } from '../tool-router';
import { chatMediaSinkFor } from '../chat-media-sink';

jest.mock('../../../runtime-ports/artifact-store', () => ({
    scopedArtifactStore: jest.fn((scope: { userId: string }) => ({
        save: jest.fn(async () => ({ urlPath: `/generated/${scope.userId}.png` })),
    })),
    mimeForExt: (ext: string) => ext === 'png' ? 'image/png' : 'audio/wav',
}));

const scoped = jest.mocked(scopedArtifactStore);
function router(): ToolRouter {
    const r = new ToolRouter();
    r.registerExternalTools('s', 'camera', [{ name: 'shot', description: '', inputSchema: { type: 'object', properties: {} } }],
        async () => offloadMediaBlocks({ content: [{ type: 'image', data: Buffer.from('png').toString('base64'), mimeType: 'image/png' }] }, 'shot'));
    return r;
}

beforeEach(() => jest.clearAllMocks());

test('동시 채팅의 미디어는 각 사용자 scope 로 저장되고 전달 URL 을 돌려준다', async () => {
    const r = router();
    const [a, b] = await Promise.all([
        r.executeTool('camera::shot', {}, { userId: 'alice', role: 'user' }),
        r.executeTool('camera::shot', {}, { userId: 'bob', role: 'user' }),
    ]);
    expect(JSON.stringify(a)).toContain('/generated/alice.png');
    expect(JSON.stringify(a)).not.toContain('/generated/bob.png');
    expect(JSON.stringify(b)).toContain('/generated/bob.png');
    expect(scoped).toHaveBeenCalledWith({ userId: 'alice', capability: 'mcp-runtime' });
    expect(scoped).toHaveBeenCalledWith({ userId: 'bob', capability: 'mcp-runtime' });
});

test('인증 문맥이 없거나 guest 이면 소유자 없는 산출물을 만들지 않는다', async () => {
    const r = router();
    await r.executeTool('camera::shot', {});
    await r.executeTool('camera::shot', {}, { userId: 'guest', role: 'guest' });
    expect(scoped).not.toHaveBeenCalled();
});

test('작업 공간 저장처가 있으면 기존 경로를 유지한다', async () => {
    const save = jest.fn(async () => undefined);
    const result = await runWithToolMediaSink({ save }, () => router().executeTool('camera::shot', {}, { userId: 'alice', role: 'user' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain('mcp-media/');
    expect(scoped).not.toHaveBeenCalled();
});

test('미디어 원본 MIME 과 종류를 보존한다', async () => {
    await runWithToolMediaSink(chatMediaSinkFor({ userId: 'alice', role: 'user' }), () =>
        offloadMediaBlocks({ content: [{ type: 'audio', data: Buffer.from('clip').toString('base64'), mimeType: 'audio/webm' }] }, 'clip'));
    const store = scoped.mock.results[0].value;
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audio', mime: 'audio/webm', ext: 'webm' }));
});

test('스크립트가 포함될 수 있는 SVG 는 앱 origin 의 산출물로 게시하지 않는다', async () => {
    const result = await runWithToolMediaSink(chatMediaSinkFor({ userId: 'alice', role: 'user' }), () =>
        offloadMediaBlocks({ content: [{ type: 'image', data: Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64'), mimeType: 'image/svg+xml' }] }, 'svg'));
    expect(scoped.mock.results[0].value.save).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('생략');
    expect(JSON.stringify(result)).not.toContain('/generated/');
});
