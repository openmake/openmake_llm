/** detectTestRunner — 셸 없이 폴더의 테스트 러너를 알아낸다(서버 프로브와 같은 조건). 실 fs(tmpdir)로 검증한다. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectTestRunner } from '../test-runner';

let base = '';
beforeEach(() => { base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-runner-'))); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

const write = (rel: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), content);
};
const pkg = (test?: string): void => write('package.json', JSON.stringify({ scripts: test === undefined ? {} : { test } }));
/** 실행 파일이 하나도 없는 PATH — python3·go 를 못 찾는 디바이스를 흉내낸다. */
const NO_TOOLS = '/nonexistent-omk-path';

describe('detectTestRunner', () => {
    it('빈 폴더는 none', async () => {
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('none');
    });

    it('npm: test 스크립트가 있고 node_modules 가 있으면 npm', async () => {
        pkg('jest');
        fs.mkdirSync(path.join(base, 'node_modules'));
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('npm');
    });

    it('npm: node_modules 가 없어도 `node …` 스크립트면 npm', async () => {
        pkg('node --test');
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('npm');
    });

    it('npm: node_modules 가 없고 node 스크립트도 아니면 고르지 않는다', async () => {
        pkg('jest');
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('none');
    });

    it('npm: 기본 자리표시자("no test specified")와 깨진 package.json 은 고르지 않는다', async () => {
        pkg('echo "Error: no test specified" && exit 1');
        fs.mkdirSync(path.join(base, 'node_modules'));
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('none');
        write('package.json', '{ 깨짐');
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('none');
    });

    it('pytest: 표식 파일이 있어도 pytest 를 import 할 수 없으면 고르지 않는다', async () => {
        write('tests/test_a.py', 'def test_a():\n    assert True\n');
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('none');
    });

    it('pytest: 표식 파일이 있고 python3 가 pytest 를 import 하면 pytest', async () => {
        write('test_a.py', 'def test_a():\n    assert True\n');
        // PATH 맨 앞에 "import pytest 성공"으로 끝나는 가짜 python3 를 둔다 — 실제 설치 여부에 기대지 않는다.
        const bin = path.join(base, '.fakebin');
        write('.fakebin/python3', '#!/bin/sh\nexit 0\n');
        fs.chmodSync(path.join(bin, 'python3'), 0o755);
        expect(await detectTestRunner(base, bin)).toBe('pytest');
    });

    it('go: go.mod 가 있고 go 실행 파일이 PATH 에 있을 때만 go', async () => {
        write('go.mod', 'module x\n');
        expect(await detectTestRunner(base, NO_TOOLS)).toBe('none');
        const bin = path.join(base, '.fakebin');
        write('.fakebin/go', '#!/bin/sh\nexit 0\n');
        fs.chmodSync(path.join(bin, 'go'), 0o755);
        expect(await detectTestRunner(base, bin)).toBe('go');
    });
});
