import { test, expect } from '@playwright/test';

test('running API reports the tested build and protects ordinary user data', async ({ request }) => {
  const sha = process.env.E2E_EXPECTED_SHA;
  expect(sha, 'selected pipeline scenario requires exact tested SHA').toMatch(/^[0-9a-f]{40}$/);
  const health = await request.get('/health');
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(body.success).toBe(true);
  expect(body.data.status).toBe('healthy');
  expect(body.data.build.gitHash).toMatch(/^[0-9a-f]{7,40}$/);
  expect(body.data.build.gitHash).toBe(process.env.E2E_EXPECTED_BUILD_HASH);
  expect(sha?.startsWith(body.data.build.gitHash)).toBe(true);
  const protectedResponse = await request.get('/api/users/me/memories');
  expect(protectedResponse.status()).toBe(401);
});
