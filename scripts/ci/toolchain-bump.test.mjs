import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENTS, applyEdits, cmp, plan, readCurrent } from './toolchain-bump.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('지금 저장소의 모든 고칠 자리가 맞는다 (패턴이 깨지면 갱신 PR 이 조용히 일부만 올린다)', () => {
    for (const [name, comp] of Object.entries(COMPONENTS)) {
        const cur = readCurrent(root, comp);
        const files = applyEdits(read, comp, '99.98.97');
        for (const [file, text] of files) {
            assert.ok(text.includes('99.98.97'), `${name}: ${file}`);
            assert.ok(!text.includes(`${cur}`) || file.endsWith('omk.sh') || file.endsWith('README.md'), `${name}: ${file} 에 옛 판이 남음`);
        }
    }
});

test('같은 구성요소의 모든 고칠 자리가 같은 판을 가리킨다', () => {
    const node = readCurrent(root, COMPONENTS.node);
    assert.match(read('mise.toml'), new RegExp(`node = "${node}"`));
    for (const f of ['infra/egress-proxy/Dockerfile', 'infra/mcp-runtime/Dockerfile']) assert.match(read(f), new RegExp(`FROM node:${node}-`));
    const lite = readCurrent(root, COMPONENTS.litellm);
    const smoke = read('.github/workflows/install-smoke.yml');
    assert.ok(smoke.includes(`LiteLLM 버전 고정 ${lite}`) && smoke.includes(`==\\"${lite}\\"`));
});

test('litellm 은 고칠 자리 다섯 곳을 모두 바꾸고, 벤치마크 설명의 판 범위는 건드리지 않는다', () => {
    const files = applyEdits(read, COMPONENTS.litellm, '9.9.9');
    const omk = files.get('scripts/env/omk.sh');
    assert.match(omk, /OMK_LITELLM_VERSION:-9\.9\.9\}/);
    assert.match(omk, /1\.102~1\.110\.2 는/);
    const readme = files.get('scripts/env/README.md');
    assert.equal((readme.match(/9\.9\.9/g) || []).length, 3);
});

test('고칠 자리가 없으면 throw', () => {
    assert.throws(() => applyEdits(() => 'nothing', COMPONENTS.pm2, '1.2.3'), /고칠 자리/);
});

test('node 는 지금 메이저 안의 최신만 고른다', async () => {
    const get = async () => [{ version: 'v27.1.0' }, { version: 'v26.14.2' }, { version: 'v26.9.0' }, { version: 'v25.0.0' }];
    const [p] = await plan(root, ['node'], get);
    assert.equal(p.latest, '26.14.2');
    assert.equal(p.bump, cmp('26.14.2', p.current) > 0);
});

test('최신이 지금보다 낮거나 같으면 bump=false', async () => {
    const cur = readCurrent(root, COMPONENTS.pm2);
    const [p] = await plan(root, ['pm2'], async () => ({ version: cur }));
    assert.equal(p.bump, false);
    await assert.rejects(plan(root, ['pm2'], async () => ({ version: 'latest' })), /최신 판을 알 수 없습니다/);
});

test('cmp 는 숫자 순서', () => {
    assert.ok(cmp('1.10.0', '1.9.9') > 0);
    assert.equal(cmp('2.0.0', '2.0.0'), 0);
});
