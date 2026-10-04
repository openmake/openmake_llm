/**
 * RequestGuard — 서버 요청(bridge_exec)을 실행하기 전에 기기가 다시 판정한다 (Companion P1, 2026-10-04).
 *
 *  - 만료: 서버가 실은 `expiresAt`(epoch ms)이 지났으면 실행하지 않는다. 연결이 끊겼다 다시 붙은 뒤 늦게 도착한
 *    명령, 서버가 이미 "응답 없음"으로 처리한 명령을 뒤늦게 실행하는 것을 막는다. 서버와 PC 의 시계가 어긋날 수
 *    있으므로 EXPIRY_SKEW_TOLERANCE_MS 만큼은 지나도 통과시킨다. `expiresAt` 가 없으면(구버전 서버) 검사하지 않는다.
 *  - 중복: 이미 처리한 `reqId` 가 다시 오면 실행하지 않는다. 기억하는 수는 SEEN_REQ_MAX 로 제한한다(오래된 것부터 잊는다).
 *
 * 판정만 한다 — 실행·응답 전송은 connection.ts 가 맡는다.
 */
import { EXPIRY_SKEW_TOLERANCE_MS, SEEN_REQ_MAX } from './constants';
import type { BridgeResult } from './types';

export class RequestGuard {
    /** 삽입 순서를 유지하는 Set — 맨 앞이 가장 오래된 reqId */
    private readonly seen = new Set<string>();

    /** 통과면 null, 거절이면 서버로 돌려줄 결과. 통과한 reqId 는 기억한다. */
    check(m: { reqId?: string; expiresAt?: number }, now: number = Date.now()): BridgeResult | null {
        if (typeof m.expiresAt === 'number' && Number.isFinite(m.expiresAt) && now > m.expiresAt + EXPIRY_SKEW_TOLERANCE_MS) {
            return { ok: false, rejected: 'expired', error: '만료된 요청이라 실행하지 않았습니다' };
        }
        if (typeof m.reqId !== 'string' || !m.reqId) return null;
        if (this.seen.has(m.reqId)) {
            return { ok: false, rejected: 'duplicate', error: '이미 처리한 요청이라 다시 실행하지 않았습니다' };
        }
        this.seen.add(m.reqId);
        if (this.seen.size > SEEN_REQ_MAX) this.seen.delete(this.seen.values().next().value as string);
        return null;
    }
}
