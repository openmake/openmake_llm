/** edit_image — hasa(generations+reference JSON) / OpenAI(edits multipart) wire, 입력 로드, 의도 게이트 */
const mockResolve = jest.fn();
jest.mock('../../services/modality-resolver', () => {
    const actual = jest.requireActual('../../services/modality-resolver');
    return { ...actual, resolveModalityTarget: (...a: unknown[]) => mockResolve(...a) };
});
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const saved: Array<{ prefix: string; ext: string; size: number }> = [];
jest.mock('../generated-media', () => ({
    saveGeneratedFile: (prefix: string, ext: string, data: Buffer) => { saved.push({ prefix, ext, size: data.length }); return { filename: `${prefix}.${ext}`, urlPath: `/generated/${prefix}.${ext}`, absPath: '/x' }; },
    resolveGeneratedPath: (p: string) => (p === '/generated/img-old.png' ? '/tmp/img-old.png' : null),
}));
jest.mock('node:fs', () => ({ ...jest.requireActual('node:fs'), readFileSync: (p: string) => (p === '/tmp/img-old.png' ? Buffer.from('PNGDATA') : jest.requireActual('node:fs').readFileSync(p)) }));

import { editImageTool } from '../image-tools';
import { MODALITY_TOOL_INTENT_GATES } from '../../config/modality';

const target = (providerId: string) => ({
    modality: 'image_edit', fullId: `${providerId}:m`, providerId, model: `${providerId}/m`, baseUrl: 'http://gw', endpoint: '/v1/images/edits',
    headers: { Authorization: 'Bearer master', 'x-api-key': 'k' }, params: {}, source: 'user', transport: 'gateway',
});
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; mockResolve.mockReset(); saved.length = 0; });

it('hasa: /v1/images/generations JSON + reference(dataURL) 로 보내고 결과를 저장한다', async () => {
    mockResolve.mockResolvedValue(target('hasa'));
    const f = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from('OUT').toString('base64') }] }), text: async () => '' }));
    global.fetch = f as unknown as typeof fetch;
    const r = await editImageTool.handler({ image_url: '/generated/img-old.png', prompt: 'make it blue' }, { userId: 'u1', role: 'user' });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('/generated/img-edit.png');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gw/v1/images/generations');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'hasa/m', prompt: 'make it blue', n: 1 });
    expect(body.reference).toMatch(/^data:image\/[a-z]+;base64,/);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(saved[0]).toMatchObject({ prefix: 'img-edit', ext: 'png', size: 3 });
});

it('OpenAI 규격: /v1/images/edits multipart(image·prompt·model)', async () => {
    mockResolve.mockResolvedValue(target('openrouter'));
    const f = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from('OUT').toString('base64') }] }), text: async () => '' }));
    global.fetch = f as unknown as typeof fetch;
    const r = await editImageTool.handler({ image_base64: Buffer.from('PNG').toString('base64'), prompt: 'p' }, undefined);
    expect(r.isError).toBeFalsy();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gw/v1/images/edits');
    const fd = init.body as FormData;
    expect(fd.get('model')).toBe('openrouter/m');
    expect(fd.get('prompt')).toBe('p');
    expect((fd.get('image') as File).name).toBe('image.png');
});

it('입력 없음·없는 파일은 오류, 미배정은 안내', async () => {
    mockResolve.mockResolvedValue(target('hasa'));
    expect((await editImageTool.handler({ prompt: 'p' }, undefined)).isError).toBe(true);
    expect((await editImageTool.handler({ prompt: 'p', image_url: '/generated/nope.png' }, undefined)).isError).toBe(true);
    const { ModalityUnavailableError } = jest.requireActual('../../services/modality-resolver');
    mockResolve.mockRejectedValue(new ModalityUnavailableError('image_edit 미배정', 'MODALITY_UNASSIGNED'));
    const r = await editImageTool.handler({ prompt: 'p', image_url: '/generated/img-old.png' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('image_edit 미배정');
});

it('edit_image 의도 게이트 — 수정 요청에만 맞는다', () => {
    const pats = MODALITY_TOOL_INTENT_GATES.find((g) => g.tool === 'edit_image')!.patterns;
    const hit = (m: string) => pats.some((re) => re.test(m));
    expect(hit('지금 이미지를 유지하면서 지금 이미지속 사람들을 동양인으로 모두 변경해줘')).toBe(true);
    expect(hit('사진에서 배경을 지워줘')).toBe(true);
    expect(hit('edit the image to add a hat')).toBe(true);
    expect(hit('가을 도심 이미지를 그려줘')).toBe(false);
    expect(hit('오늘 날씨 어때')).toBe(false);
});
