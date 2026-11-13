/**
 * PR-A 6차 리뷰(REVIEW_A_R6.md) U1 + 설계 D-11 규칙 3 개정(조상 지우기) — 파일 kind 는 `HEAD` 항목의 유무를 바꾸지 못한다,
 * 폴더째 지우기로도. Rust `git_review_r6.rs` 와 같은 사례. 작업 폴더는 실제 홈 아래 임시 폴더다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BridgeCore } from '../core';
import type { BridgeMsg, BridgeResult } from '../types';

const DENIED = 'git 디렉터리 보호 경로는 쓰거나 지울 수 없습니다: ';
const REF = 'ref: refs/heads/main\n';

let tmp = '';
let root = '';

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.userInfo().homedir), '.omk-gitr6-'));
    root = path.join(tmp, 'plain');
    fs.mkdirSync(root);
});
afterEach(() => {
    try { fs.chmodSync(path.join(root, 'D', 'zlocked'), 0o755); } catch { /* zlocked 사례만 */ }
    fs.rmSync(tmp, { recursive: true, force: true });
});

function file(rel: string, content: string): void {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
}
function exists(rel: string): boolean {
    try { fs.lstatSync(path.join(root, rel)); return true; } catch { return false; }
}
function makeCore(): BridgeCore {
    const core = new BridgeCore({ folder: root, confirm: async () => 'no', sandboxProfileDir: os.tmpdir() });
    core.prepare();
    return core;
}
function run(core: BridgeCore, m: BridgeMsg): Promise<BridgeResult> {
    return new Promise((resolve) => {
        core.handleExec(m, resolve).catch((e) => resolve({ ok: false, error: String((e as Error).message || e) }));
    });
}
const del = (p: string): BridgeMsg => ({ kind: 'delete', path: p } as BridgeMsg);
const write = (p: string): BridgeMsg => ({ kind: 'write', path: p, contentB64: 'eA==' } as BridgeMsg);
const denied = (p: string): BridgeResult => ({ ok: false, error: `${DENIED}${p}` });
const ok = { ok: true };

describe('U1 — 파일 kind 는 폴더째 지우기로도 HEAD 항목의 유무를 바꾸지 못한다(D-11 규칙 3 개정)', () => {
    it('HEAD 를 품은 폴더(바로 아래·더 아래, 대소문자 무관)는 폴더째 지울 수 없다 — HEAD 는 남는다', async () => {
        file('sub/HEAD', REF);
        file('outer/sub/HEAD', REF);
        file('low/x/head', 'notes\n');
        const core = makeCore();
        for (const [p, head] of [['sub', 'sub/HEAD'], ['outer', 'outer/sub/HEAD'], ['outer/sub', 'outer/sub/HEAD'], ['low', 'low/x/head']]) {
            expect(await run(core, del(p))).toEqual(denied(p));
            expect(exists(head)).toBe(true);
        }
    });

    it('과한 차단 없음: HEAD 없는 폴더, .git 아래에만 HEAD 가 있는 중첩 레포 폴더, HEAD 폴더를 가리키는 심링크는 지운다', async () => {
        file('docs/a/b.md', 'x');
        file('vendor/lib/.git/HEAD', REF);
        file('vendor/lib/.git/refs/heads/main', 'x');
        file('vendor2/lib/.GIT/HEAD', REF);
        file('sub/HEAD', REF);
        fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'alias'));
        const core = makeCore();
        for (const p of ['docs', 'vendor/lib', 'vendor2', 'alias']) {
            expect(await run(core, del(p))).toEqual(ok);
            expect(exists(p)).toBe(false);
        }
        expect(exists('sub/HEAD')).toBe(true);
    });

    // 수정 전에는 지우기가 도중에 실패한 뒤 HEAD 만 없고 구조가 남아 D/config 쓰기가 통과했다(실측). 이름 `zlocked`: Rust 의
    // remove_dir_all 은 나열 순서대로 지우다 첫 오류에서 멈추고 APFS 의 나열 순서는 이름 해시라 `locked` 는 HEAD 보다 먼저,
    // `zlocked` 는 뒤에 나온다(실측) — 두 러너에서 같은 사례가 되도록 같은 이름을 쓴다.
    it('지워지지 않는 하위 항목이 있는 git 디렉터리 꼴 폴더: 지우기 거절, HEAD 그대로, config 거절', async () => {
        file('D/HEAD', REF);
        file('D/objects/.keep', '');
        file('D/refs/heads/.keep', '');
        file('D/zlocked/f', 'x');
        fs.chmodSync(path.join(root, 'D', 'zlocked'), 0o555);
        const core = makeCore();
        expect(await run(core, del('D'))).toEqual(denied('D'));
        expect(exists('D/HEAD')).toBe(true);
        expect(await run(core, write('D/config'))).toEqual(denied('D/config'));
    });
});
