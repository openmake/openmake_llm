/**
 * 멀티에이전트 토론(Discussion) 회귀 스모크 E2E
 *
 * 목적: fan-out 동시성 상한 보강(`DISCUSSION_MAX_PARALLEL_AGENTS`, 기본 5) 적용 후에도
 *       토론 모드가 end-to-end 로 정상 동작(멀티에이전트 → 합성 → 응답)하는지 확인.
 *
 * 범위 주의:
 * - 이 테스트는 "토론이 여전히 정상 작동"하는 **회귀 스모크**입니다.
 *   동시성 상한 값 자체(라운드 내 in-flight ≤ cap)는 서버 내부 동작이라 브라우저로 관측 불가하며,
 *   `backend/api/src/__tests__/discussion-engine.test.ts` 의 단위 테스트가 검증합니다.
 * - 실제 vLLM(LLM 백엔드)을 호출합니다 → 토큰 소비 + 수 분 소요.
 *   **반드시 변경분이 반영된 서버(rebuild + restart 이후)에 대해 실행**해야 의미가 있습니다.
 *
 * 트리거: POST /api/chat/stream (SSE) + { discussionMode: true }
 * 인증:   Pro 이상 등급 필요 → signupUser({ promoteAdmin: true })로 enterprise 승격
 */

import { test, expect } from '@playwright/test';
import { signupUser, deleteUser, type GdprUserFixture } from './helpers/gdpr-fixtures';

const DISCUSSION_TIMEOUT_MS = 5 * 60 * 1000; // 토론은 다수 LLM 호출 → 넉넉한 타임아웃

// REST /api/chat/stream 은 model 필수 (빈 model 자동 선택은 WS 경로 전용).
// env 우선, 미설정 시 기본 카탈로그 모델 fallback.
const MODEL = process.env.LLM_DEFAULT_MODEL || 'qwen3.6-35b-a3b';

test.describe('멀티에이전트 토론 회귀 스모크', () => {
    let user: GdprUserFixture;

    test.beforeAll(async ({ request }) => {
        // 토론은 Pro 이상 등급 전용 → enterprise 로 승격된 유저 생성
        user = await signupUser(request, { promoteAdmin: true });
    });

    test.afterAll(async () => {
        if (user) await deleteUser(user.userId);
    });

    test('discussionMode=true 요청이 에러 없이 토론 결과를 스트리밍한다', async ({ request }) => {
        test.setTimeout(DISCUSSION_TIMEOUT_MS);

        const resp = await request.post('/api/chat/stream', {
            headers: {
                cookie: user.cookies,
                'content-type': 'application/json',
            },
            data: {
                message: '원격 근무와 사무실 근무 중 무엇이 팀 생산성에 더 유리한가?',
                model: MODEL,
                discussionMode: true,
            },
            timeout: DISCUSSION_TIMEOUT_MS,
        });

        expect(resp.status()).toBe(200);

        const body = await resp.text();

        // SSE data 이벤트 파싱: 각 라인은 `data: {json}` 형식
        const events = body
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => {
                try {
                    return JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>;
                } catch {
                    return null;
                }
            })
            .filter((e): e is Record<string, unknown> => e !== null);

        expect(events.length).toBeGreaterThan(0);

        // 1) 에러 이벤트가 없어야 함
        const errorEvent = events.find(e => typeof e.error === 'string');
        expect(errorEvent, `토론 중 에러 이벤트 발생: ${JSON.stringify(errorEvent)}`).toBeUndefined();

        // 2) 정상 완료 시그널(done:true)이 와야 함
        const doneEvent = events.find(e => e.done === true);
        expect(doneEvent, '완료(done:true) 이벤트가 수신되지 않음').toBeDefined();

        // 3) 토론 산출물(토큰 누적 텍스트)이 의미 있는 길이여야 함
        const fullText = events
            .filter(e => typeof e.token === 'string')
            .map(e => e.token as string)
            .join('');
        expect(fullText.length).toBeGreaterThan(200);

        // 4) 세션이 생성되어야 함 (DB 기록 확인)
        const sessionEvent = events.find(e => typeof e.sessionId === 'string');
        expect(sessionEvent, 'sessionId 이벤트가 수신되지 않음').toBeDefined();
    });
});
