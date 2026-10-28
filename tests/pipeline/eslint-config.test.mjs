// 루트 eslint.config.mjs 의 무시 범위 — 저장소 안 .worktrees/ 에 둔 git worktree 는 각자 eslint.config.mjs 를 가진
// 저장소 사본이라, 루트 lint 가 그 안까지 읽으면 typescript-eslint 가 모든 파일에서 파싱 오류를 낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('root eslint config skips local .worktrees but still lints repository sources', async () => {
  const eslint = new ESLint({ cwd: repoRoot });
  assert.equal(await eslint.isPathIgnored(resolve(repoRoot, '.worktrees/some-branch/apps/api/src/server.ts')), true);
  assert.equal(await eslint.isPathIgnored(resolve(repoRoot, 'apps/api/src/server.ts')), false);
});
