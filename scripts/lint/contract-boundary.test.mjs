/**
 * eslint 경계 규칙 fixture — 저장소의 eslint.config.mjs 를 그대로 읽어 가상 파일을 검사한다(node --test).
 *  ① 계약 패키지(packages/plugin-contracts/src)는 apps·외부 패키지·패키지 밖을 import 하지 못한다(런타임 의존 0).
 *  ② apps/api 소스는 @openmake/plugin-contracts 를 type-only 로만 쓴다(배포에 워크스페이스 링크가 없을 수 있다).
 *  ③ apps/api 테스트 파일은 값(상수)을 비교용으로 import 할 수 있다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const eslint = new ESLint({ cwd: ROOT });
const RESTRICTED_RULES = new Set(['no-restricted-imports', '@typescript-eslint/no-restricted-imports']);

/** 가상 파일을 lint 해 import 제한 규칙에 걸린 줄 번호(중복 제거·정렬)를 돌려준다 */
async function restrictedLines(relPath, code) {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, relPath) });
    const lines = result.messages.filter((m) => RESTRICTED_RULES.has(m.ruleId ?? '')).map((m) => m.line);
    return [...new Set(lines)].sort((a, b) => a - b);
}

const CONTRACT_FILE = 'packages/plugin-contracts/src/__boundary_fixture__.ts';
const API_FILE = 'apps/api/src/runtime-ports/__boundary_fixture__.ts';
const API_TEST_FILE = 'apps/api/src/runtime-ports/__tests__/__boundary_fixture__.test.ts';

test('계약 패키지는 apps 를 import 할 수 없다', async () => {
    const code = "import type { AddonManifest } from '../../../apps/api/src/addon-host/manifest';\nexport type X = AddonManifest;\n";
    assert.deepEqual(await restrictedLines(CONTRACT_FILE, code), [1]);
});

test('계약 패키지는 외부 패키지(런타임 의존)를 import 할 수 없다', async () => {
    const code = "import { z } from 'zod';\nexport const schema = z;\n";
    assert.deepEqual(await restrictedLines(CONTRACT_FILE, code), [1]);
});

test('계약 패키지는 자기 디렉터리 밖(다른 패키지 소스)을 import 할 수 없다', async () => {
    const code = "import type { ApiMeta } from '../../shared-types/src';\nexport type M = ApiMeta;\n";
    assert.deepEqual(await restrictedLines(CONTRACT_FILE, code), [1]);
});

test('계약 패키지 안의 상대 import 는 허용된다', async () => {
    const code = "import type { Actor } from './actor';\nexport type A = Actor;\n";
    assert.deepEqual(await restrictedLines(CONTRACT_FILE, code), []);
});

test('apps/api 소스는 계약 패키지를 type-only 로만 import 한다', async () => {
    const code = [
        "import type { Actor } from '@openmake/plugin-contracts';",
        "export type { AddonState } from '@openmake/plugin-contracts';",
        "import { PLUGIN_CONTRACT_VERSION } from '@openmake/plugin-contracts';",
        "export { ADDON_STATES } from '@openmake/plugin-contracts';",
        'export const v: Actor | string = PLUGIN_CONTRACT_VERSION;',
        '',
    ].join('\n');
    assert.deepEqual(await restrictedLines(API_FILE, code), [3, 4]);
});

test('apps/api 테스트 파일은 계약 상수를 값으로 import 할 수 있다', async () => {
    const code = "import { PLUGIN_CONTRACT_VERSION } from '@openmake/plugin-contracts';\nexport const v = PLUGIN_CONTRACT_VERSION;\n";
    assert.deepEqual(await restrictedLines(API_TEST_FILE, code), []);
});
