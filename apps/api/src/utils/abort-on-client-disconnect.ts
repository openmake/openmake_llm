/**
 * 클라이언트가 응답을 다 받기 전에 연결을 끊으면 abort 되는 신호를 만든다 — REST 라우트가 upstream LLM 호출을 끊는 데 쓴다.
 *
 * req 'close' 는 쓰지 않는다: Express 5 에서는 요청 본문을 다 읽은 직후에 나므로(클라이언트가 붙어 있어도)
 * 동기 등록이면 항상 abort, await 뒤 등록이면 영영 안 불린다. res 'close' + `!res.writableEnded` 가 맞는 신호다.
 *
 * - 정상 종료(res.end 뒤 close)에서는 abort 하지 않는다.
 * - 호출 시점에 이미 끊긴 연결(인증·세션 조회 await 사이에 close 가 지나간 경우)이면 abort 된 신호를 바로 준다.
 *   끊긴 소켓의 res 는 `destroyed` 가 true 다(Node 24 · Express 5 실서버 테스트로 확인).
 *
 * @module utils/abort-on-client-disconnect
 */
import type { Response } from 'express';

export function abortOnClientDisconnect(res: Response): AbortSignal {
    const controller = new AbortController();
    if (res.destroyed && !res.writableEnded) {
        controller.abort();
    } else {
        res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    }
    return controller.signal;
}
