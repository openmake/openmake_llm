/**
 * Phase 4 E2E — Git URL → MCPSERVER.md → draft → approve/reject.
 *
 * 백엔드 요구사항: MCP_INGEST_E2E_MOCK=true 환경변수.
 *   - routes/setup.ts 가 GitFetcher 를 MockGitFetcher 로 교체.
 *   - URL 의 repo 가 'malicious' 포함 시 위험 명령 픽스처 반환.
 *
 * 실행:
 *   MCP_INGEST_E2E_MOCK=true npm run dev:api &
 *   sleep 5
 *   npm run dev:frontend &
 *   npm run test:e2e -- tests/e2e/mcp-server-ingest.spec.ts
 *
 * tests/ 디렉토리는 .gitignore (line 99) — 본 spec 은 로컬 회귀 검증용.
 */
import { test, expect } from '@playwright/test';

test.describe('MCP server Git ingest (Phase 4)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // TODO: 프로젝트 e2e auth helper 가 자리잡으면 그것으로 교체.
        // 현재는 page reload 후 mcp-servers 라우트로 직접 이동.
        await page.goto('/#/mcp-servers');
        await expect(page.locator('#mcp-import-from-git-btn')).toBeVisible({ timeout: 8000 });
    });

    test('full flow — import → draft → 승인', async ({ page }) => {
        await page.locator('#mcp-import-from-git-btn').click();
        const modal = page.locator('#mcp-import-modal');
        await expect(modal).toHaveClass(/active/);

        await modal.locator('#mcp-import-git-url').fill('https://github.com/test-org/mcp-fixture-postgres');
        await modal.locator('#mcp-import-submit').click();

        // 성공 시 모달 닫히고 "내 서버" 탭으로 전환됨
        await expect(modal).not.toHaveClass(/active/, { timeout: 10000 });
        await expect(page.locator('#mcp-panel-my-servers')).toHaveClass(/active/);

        // draft 섹션에 카드 표시
        const draftContainer = page.locator('#mcp-drafts-container');
        await expect(draftContainer).toBeVisible();
        const card = draftContainer.locator('.mcp-server-draft-card').first();
        await expect(card).toBeVisible();
        await expect(card.locator('.skill-draft-card__title')).toContainText('PostgreSQL');

        // required_env 입력 prompt 자동 수락 (DATABASE_URL → 임의 값)
        page.on('dialog', async d => {
            if (d.type() === 'prompt') await d.accept('postgres://test@localhost/test');
            else await d.accept();
        });
        await card.locator('button[data-action="approve"]').click();

        // 카드가 사라지거나 새로고침 후 활성 서버 목록으로 이동
        await expect(card).toHaveCount(0, { timeout: 6000 });
    });

    test('blocked — 위험 명령 매니페스트는 승인 버튼 disabled', async ({ page }) => {
        await page.locator('#mcp-import-from-git-btn').click();
        const modal = page.locator('#mcp-import-modal');
        await modal.locator('#mcp-import-git-url').fill('https://github.com/test-org/mcp-fixture-malicious');
        await modal.locator('#mcp-import-submit').click();

        await expect(modal).not.toHaveClass(/active/, { timeout: 10000 });

        const card = page.locator('#mcp-drafts-container .mcp-server-draft-card').first();
        await expect(card).toBeVisible();
        const approveBtn = card.locator('button[data-action="approve"]');
        await expect(approveBtn).toBeDisabled();
    });

    test('reject — draft 거부 시 사라짐', async ({ page }) => {
        await page.locator('#mcp-import-from-git-btn').click();
        const modal = page.locator('#mcp-import-modal');
        await modal.locator('#mcp-import-git-url').fill('https://github.com/test-org/mcp-fixture-postgres-reject');
        await modal.locator('#mcp-import-submit').click();

        await expect(modal).not.toHaveClass(/active/, { timeout: 10000 });
        page.on('dialog', d => d.accept());
        const card = page.locator('#mcp-drafts-container .mcp-server-draft-card').first();
        await expect(card).toBeVisible();
        await card.locator('button[data-action="reject"]').click();

        await expect(card).toHaveCount(0, { timeout: 6000 });
    });
});
