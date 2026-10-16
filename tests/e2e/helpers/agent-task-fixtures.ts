/**
 * Agent Task E2E 픽스처 — CSRF(enforce) 서버에서도 동작하는 가입·로그인.
 *
 * gdpr-fixtures 의 signupUser 와 같은 방식(가입 → 로그인 → auth_token 쿠키)이지만,
 * 서버 기본값 CSRF_PROTECTION=enforce 에서는 쿠키 인증 POST/DELETE 에 Double-Submit
 * 토큰(csrf_token 쿠키 + X-CSRF-Token 헤더)이 필요하므로 먼저 /api/csrf-token 에서 받는다.
 * 가입·로그인 흐름은 e2e-account 의 signupE2eAccount 를 쓴다.
 * 사용자 정리는 gdpr-fixtures 의 deleteUser(id 지정)를 그대로 쓴다.
 */
import { request as pwRequest } from '@playwright/test';
import { fetchCsrfToken, signupE2eAccount } from './e2e-account';

export { fetchCsrfToken };

const TEST_PW = 'AgentTaskE2E!2026';

export interface AgentTaskUserFixture {
    userId: string;
    email: string;
    /** 모든 요청에 그대로 붙이는 헤더 — 인증 쿠키 + CSRF 쿠키·헤더 */
    headers: Record<string, string>;
}

/** 게스트용 CSRF 헤더 — 인증 게이트(401)를 CSRF 거절(403)과 구분해 보려고 쓴다 */
export async function guestCsrfHeaders(baseURL: string | undefined): Promise<Record<string, string>> {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const token = await fetchCsrfToken(ctx);
        return { Cookie: `csrf_token=${token}`, 'X-CSRF-Token': token };
    } finally {
        await ctx.dispose();
    }
}

/** 신규 사용자 가입 + 로그인. 사용자마다 별도 request context 라 쿠키가 섞이지 않는다. */
export async function signupAgentTaskUser(baseURL: string | undefined): Promise<AgentTaskUserFixture> {
    const { userId, email, headers } = await signupE2eAccount(baseURL, { prefix: 'e2e-agent-task', password: TEST_PW });
    return { userId, email, headers };
}
