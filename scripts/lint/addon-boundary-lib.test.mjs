/**
 * add-on → Base 내부 import 수집기(addon-boundary-lib) 단위 테스트 — node --test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseTargetsOf, collectAddonBaseImports, countPairs, diffAllowlist } from './addon-boundary-lib.mjs';

const SRC = join('/repo', 'apps', 'api', 'src');
const FILE = join(SRC, 'addons', 'demo', 'sub', 'thing.ts');

test('정적·type·export from·동적 import·require·부수효과 import 를 모두 잡고 src 기준 경로로 정규화한다', () => {
    const source = [
        "import { a } from '../../../data/conversation-sessions';",
        "import type { B } from '../../../services/org/membership-cache';",
        "export { c } from '../../../chat/language-policy';",
        "const d = await import('../../../routes/x');",
        "const e = require('../../../middlewares/y');",
        "import '../../../auth/side-effect';",
        "import {",
        "    f,",
        "} from '../../../sockets/z';",
        "import { g } from '../../../controllers/w';",
    ].join('\n');
    assert.deepEqual(baseTargetsOf(source, FILE, SRC), [
        'auth/side-effect', 'chat/language-policy', 'controllers/w', 'data/conversation-sessions',
        'middlewares/y', 'routes/x', 'services/org/membership-cache', 'sockets/z',
    ]);
});

test('허용 계층(runtime-ports·addon-host·config·utils)·같은 add-on 안·외부 패키지·계약 패키지는 세지 않는다', () => {
    const source = [
        "import { p } from '../../../runtime-ports/base-data-port';",
        "import { h } from '../../../addon-host';",
        "import { c } from '../../../config/env';",
        "import { u } from '../../../utils/logger';",
        "import { s } from '../services/local';",
        "import { z } from 'zod';",
        "import type { A } from '@openmake/plugin-contracts';",
    ].join('\n');
    assert.deepEqual(baseTargetsOf(source, FILE, SRC), []);
});

test('같은 대상을 여러 번 import 해도 한 번만 센다', () => {
    const source = [
        "import { a } from '../../../data/x';",
        "import type { B } from '../../../data/x';",
        "const c = await import('../../../data/x');",
    ].join('\n');
    assert.deepEqual(baseTargetsOf(source, FILE, SRC), ['data/x']);
});

test('diffAllowlist — 목록 밖의 새 쌍은 added, 코드에서 사라진 쌍은 removed', () => {
    const allowlist = { 'a/one.ts': ['data/x', 'services/y'], 'b/two.ts': ['auth/z'] };
    const current = { 'a/one.ts': ['data/x', 'routes/new'], 'c/three.ts': ['chat/q'] };
    assert.deepEqual(diffAllowlist(allowlist, current), {
        added: ['a/one.ts → routes/new', 'c/three.ts → chat/q'],
        removed: ['a/one.ts → services/y', 'b/two.ts → auth/z'],
    });
});

test('countPairs 는 (파일, 대상) 쌍 수를 센다', () => {
    assert.equal(countPairs({ 'a.ts': ['data/x', 'data/y'], 'b.ts': ['chat/z'] }), 3);
    assert.equal(countPairs({}), 0);
});

test('collectAddonBaseImports — 테스트·evaluation 은 빼고 파일 키는 addons 기준 posix 경로', () => {
    const root = mkdtempSync(join(tmpdir(), 'addon-boundary-'));
    try {
        const addon = join(root, 'apps', 'api', 'src', 'addons', 'demo');
        mkdirSync(join(addon, '__tests__'), { recursive: true });
        mkdirSync(join(addon, 'evaluation'), { recursive: true });
        mkdirSync(join(addon, 'sub'), { recursive: true });
        writeFileSync(join(addon, 'index.ts'), "import { a } from '../../data/conversation-sessions';\n");
        writeFileSync(join(addon, 'sub', 'deep.ts'), "import { b } from '../../../services/x';\n");
        writeFileSync(join(addon, 'clean.ts'), "import { c } from '../../runtime-ports/base-data-port';\n");
        writeFileSync(join(addon, 'index.test.ts'), "import { a } from '../../data/conversation-sessions';\n");
        writeFileSync(join(addon, '__tests__', 'x.test.ts'), "import { a } from '../../../data/conversation-sessions';\n");
        writeFileSync(join(addon, 'evaluation', 'seed.ts'), "import { a } from '../../../data/conversation-sessions';\n");
        assert.deepEqual(collectAddonBaseImports(root), {
            'demo/index.ts': ['data/conversation-sessions'],
            'demo/sub/deep.ts': ['services/x'],
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
