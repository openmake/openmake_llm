/**
 * MCP 결과의 이미지·오디오 블록 — base64 를 본문에 싣지 않는다. 작업 공간이 있으면 파일로 저장해 경로를 적고,
 * 없으면 건수·종류·크기만 적는다. 종전에는 블록이 JSON 으로 직렬화돼 base64 가 그대로 모델에 갔다.
 */
import { offloadMediaBlocks } from '../media-content';

const PNG = Buffer.from('fake-png-bytes-0123456789').toString('base64');   // 25바이트
const WAV = Buffer.alloc(3000, 7).toString('base64');

describe('offloadMediaBlocks', () => {
    it('작업 공간이 있으면 파일로 저장하고 블록을 경로 안내로 바꾼다', async () => {
        const saved: Array<{ path: string; data: Buffer }> = [];
        const sink = { save: async (path: string, data: Buffer) => { saved.push({ path, data }); } };
        const r = await offloadMediaBlocks({ content: [
            { type: 'text', text: '차트를 만들었습니다' },
            { type: 'image', data: PNG, mimeType: 'image/png' },
        ] }, 'make chart/v2', sink);
        expect(saved).toHaveLength(1);
        expect(saved[0].path).toMatch(/^mcp-media\/make_chart_v2-[0-9a-f]{8}\.png$/);
        expect(saved[0].data.toString()).toBe('fake-png-bytes-0123456789');
        expect(r.content).toEqual([
            { type: 'text', text: '차트를 만들었습니다' },
            { type: 'text', text: `[이미지 저장됨: ${saved[0].path} (image/png, 25B)]` },
        ]);
        expect(JSON.stringify(r)).not.toContain(PNG);
    });

    it('작업 공간이 없으면 블록을 빼고 종류별로 건수·종류·크기를 적는다', async () => {
        const r = await offloadMediaBlocks({ content: [
            { type: 'image', data: PNG, mimeType: 'image/png' },
            { type: 'text', text: '본문' },
            { type: 'image', data: PNG, mimeType: 'image/jpeg' },
            { type: 'audio', data: WAV, mimeType: 'audio/wav' },
        ] }, 't', undefined);
        expect(r.content).toEqual([
            { type: 'text', text: '본문' },
            { type: 'text', text: '[이미지 2건 생략 — image/png 25B, image/jpeg 25B]' },
            { type: 'text', text: '[오디오 1건 생략 — audio/wav 2.9KB]' },
        ]);
    });

    it('저장에 실패하거나 저장 상한을 넘으면 생략 안내로 돌린다', async () => {
        const failing = { save: async () => { throw new Error('quota'); } };
        const r = await offloadMediaBlocks({ content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] }, 't', failing);
        expect(r.content).toEqual([{ type: 'text', text: '[이미지 1건 생략 — image/png 25B]' }]);

        const save = jest.fn(async () => undefined);
        const big = await offloadMediaBlocks({ content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] }, 't', { save }, { maxSaveBytes: 10 });
        expect(save).not.toHaveBeenCalled();
        expect(big.content).toEqual([{ type: 'text', text: '[이미지 1건 생략 — image/png 25B]' }]);
    });

    it('미디어 블록이 없으면 받은 결과 그대로다', async () => {
        const input = { content: [{ type: 'text', text: 'a' }, { type: 'resource', text: 'b' }], isError: false };
        expect(await offloadMediaBlocks(input, 't', undefined)).toBe(input);
        const none: { content?: Array<{ type: string }>; isError: boolean } = { isError: true };
        expect(await offloadMediaBlocks(none, 't', undefined)).toBe(none);
    });

    it('꺼져 있으면 건드리지 않는다', async () => {
        const input = { content: [{ type: 'image', data: PNG, mimeType: 'image/png' }] };
        expect(await offloadMediaBlocks(input, 't', undefined, { enabled: false })).toBe(input);
    });
});
