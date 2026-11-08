/**
 * WS 채팅 history 이미지 검증(2026-11-08 멀티턴 vision) — 웹이 이전 턴 이미지를 history 에 실어 보내므로
 * 서버가 항목별 형식·길이와 요청 전체(현재 턴 + history) 이미지 수를 MAX_IMAGES 로 다시 검사한다.
 */
import type { WebSocket } from 'ws';
import { validateHistoryImages } from '../ws-chat-history-images';
import { handleChatMessage } from '../ws-chat-handler';
import type { ExtendedWebSocket, WSMessage } from '../ws-types';
import { FILE_ATTACH_LIMITS } from '../../config/runtime-limits';

const limits = { MAX_IMAGES: 20, MAX_IMAGE_DATAURL_CHARS: 100 };
const img = 'data:image/png;base64,AAAA';
const many = (n: number) => Array.from({ length: n }, () => img);

describe('validateHistoryImages', () => {
    it('history 가 배열이 아니면 통과(기존 처리에 맡긴다)', () => {
        expect(validateHistoryImages(undefined, 0, limits)).toEqual({ ok: true });
        expect(validateHistoryImages('x', 0, limits)).toEqual({ ok: true });
    });
    it('정상 — 현재 턴 + history 합이 상한 이하', () => {
        expect(validateHistoryImages([{ role: 'user', content: 'a', images: many(19) }, { role: 'assistant', content: 'b' }], 1, limits)).toEqual({ ok: true });
    });
    it('항목 하나가 상한을 넘으면 실패', () => {
        expect(validateHistoryImages([{ role: 'user', content: 'a', images: many(21) }], 0, limits))
            .toEqual({ ok: false, message: '이미지는 최대 20개까지 첨부할 수 있습니다' });
    });
    it('요청 전체 합이 상한을 넘으면 실패(현재 1 + history 20)', () => {
        expect(validateHistoryImages([{ role: 'user', content: 'a', images: many(10) }, { role: 'user', content: 'b', images: many(10) }], 1, limits))
            .toEqual({ ok: false, message: '이미지는 최대 20개까지 첨부할 수 있습니다' });
    });
    it('원소 길이가 상한을 넘으면 실패', () => {
        expect(validateHistoryImages([{ role: 'user', content: 'a', images: ['x'.repeat(101)] }], 0, limits))
            .toEqual({ ok: false, message: '이미지 데이터가 너무 큽니다' });
    });
    it('원소가 문자열이 아니거나 images 가 배열이 아니면 실패', () => {
        expect(validateHistoryImages([{ role: 'user', content: 'a', images: [1] }], 0, limits).ok).toBe(false);
        expect(validateHistoryImages([{ role: 'user', content: 'a', images: 'x' }], 0, limits).ok).toBe(false);
    });
});

describe('handleChatMessage — history 이미지 초과', () => {
    it('요청 전체 이미지가 MAX_IMAGES 를 넘으면 처리 전에 error 를 보낸다', async () => {
        const sent: Array<Record<string, unknown>> = [];
        const ws = { OPEN: 1, readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
        const extWs = { ...ws, _abortController: null } as unknown as ExtendedWebSocket;
        const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
        const msg = {
            type: 'chat', message: '아까 그 그림은?', images: [img],
            history: [{ role: 'user', content: '그림', images: many(FILE_ATTACH_LIMITS.MAX_IMAGES) }, { role: 'assistant', content: '네' }],
        } as WSMessage;
        await handleChatMessage(ws, msg, { cluster: {} as never, extWs, logger: log });
        expect(sent).toEqual([{ type: 'error', message: `이미지는 최대 ${FILE_ATTACH_LIMITS.MAX_IMAGES}개까지 첨부할 수 있습니다` }]);
        expect(extWs._abortController).toBeNull();
    });
});
