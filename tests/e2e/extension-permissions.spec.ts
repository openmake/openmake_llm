/**
 * 설치형 확장 권한 재승인 E2E (마이그레이션 190) — 로컬 전용(CI 는 e2e 를 돌리지 않는다).
 *
 * 시나리오: 레거시 확장(권한 선언 없음) 1건을 DB 에 직접 만든다 → 설정 → 확장 화면에 "레거시 미검토" 배지 →
 *           상세를 열고 재승인 → 배지가 "권한 검토됨" 으로 바뀌고 DB 에 승인 기록(network:internet, 승인자)이 남는다.
 * 설치는 Git·ZIP 원격 소스가 필요해 DB 픽스처로 대신한다(설치 경로의 권한 판정은 Jest 가 고정한다).
 * 배지는 locale 과 무관하게 data-kind 로 본다.
 *
 * 실행(웹이 /api 를 API 로 넘기므로 웹 주소를 준다):
 *   PW_TEST_BASE_URL=http://localhost:3010 npx playwright test tests/e2e/extension-permissions.spec.ts --project=chromium
 *   (TEST_DATABASE_URL 은 tests/e2e/.env.e2e 또는 셸 — 이름이 _test 로 끝나는 격리 DB, 픽스처·정리용)
 *
 * 정리: spec 이 만든 확장·사용자만 id 로 지운다.
 */
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { deleteUser, pgConfig } from './helpers/gdpr-fixtures';
import { signupAgentTaskUser, type AgentTaskUserFixture } from './helpers/agent-task-fixtures';

const RUN_ID = Date.now();
const EXTENSION_ID = `user-ext-e2e-perm-${RUN_ID}`;
const EXTENSION_NAME = `e2e-perm-${RUN_ID}`;
const UI_TIMEOUT_MS = 10_000;

let user: AgentTaskUserFixture | null = null;

async function sql<T extends Record<string, unknown>>(text: string, params: unknown[]): Promise<T[]> {
    const pg = new Client(pgConfig());
    await pg.connect();
    try {
        return (await pg.query(text, params)).rows as T[];
    } finally {
        await pg.end();
    }
}

/** 'auth_token=…; csrf_token=…' → 이름별 값 */
function parseCookieHeader(header: string): Record<string, string> {
    return Object.fromEntries(header.split('; ').map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)];
    }));
}

test.describe('확장 권한 재승인', () => {
    test.beforeAll(async ({ baseURL }) => {
        user = await signupAgentTaskUser(baseURL);
        await sql(
            `INSERT INTO user_extensions
               (id, user_id, name, version, description, source_url, source_ref, source_path, source_hash, manifest, status)
             VALUES ($1, $2, $3, '1.0.0', 'e2e 권한 픽스처', 'https://example.invalid/e2e/perm', 'e2e0000', 'plugin.json', $4, $5::jsonb, 'active')`,
            [
                EXTENSION_ID, user.userId, EXTENSION_NAME, `sha256:e2e-${EXTENSION_ID}`,
                JSON.stringify({ plugin: { name: EXTENSION_NAME }, components: { skills: [], mcpServers: [], agents: [] }, warnings: [] }),
            ],
        );
    });

    test.afterAll(async () => {
        await sql('DELETE FROM user_extensions WHERE id = $1', [EXTENSION_ID]);
        if (user) await deleteUser(user.userId);
    });

    test('레거시 배지 → 재승인 → 검토됨', async ({ page, context, baseURL }) => {
        if (!user || !baseURL) throw new Error('fixture not ready');
        const cookies = parseCookieHeader(user.headers.Cookie);
        await context.addCookies([
            { name: 'auth_token', value: cookies.auth_token, url: baseURL },
            { name: 'csrf_token', value: cookies.csrf_token, url: baseURL },
        ]);

        await page.goto('/settings?tab=extensions');
        const row = page.locator('li', { hasText: EXTENSION_NAME }).first();
        const badge = row.getByTestId('ext-permission-badge');
        await expect(badge).toHaveAttribute('data-kind', 'legacy', { timeout: UI_TIMEOUT_MS });

        await row.getByRole('button', { name: new RegExp(EXTENSION_NAME) }).click();
        page.once('dialog', (dialog) => void dialog.accept());
        await row.getByTestId('ext-permission-approve').click();

        await expect(badge).toHaveAttribute('data-kind', 'reviewed', { timeout: UI_TIMEOUT_MS });
        const [saved] = await sql<{ permission_state: string; permissions_granted: string[] | null; permissions_reviewed_by: string | null }>(
            'SELECT permission_state, permissions_granted, permissions_reviewed_by FROM user_extensions WHERE id = $1',
            [EXTENSION_ID],
        );
        expect(saved).toEqual({ permission_state: 'reviewed', permissions_granted: ['network:internet'], permissions_reviewed_by: user.userId });
    });
});
