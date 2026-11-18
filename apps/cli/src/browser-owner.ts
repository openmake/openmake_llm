/**
 * 브라우저 주인 잠금 — 한 PC 에서 브라우저(OMK_BRIDGE_BROWSER=1)를 맡는 CLI 프로세스는 하나다.
 * 폴더별 deviceId 로 여러 CLI 가 함께 붙어 있어도 같은 프로필의 Chrome 을 따로 조종하지 않게 한다.
 *
 * 잠금 파일 내용은 `{pid, token}`(token 은 잡을 때마다 새 UUID). 지우는 단계 없이, 단계마다 원자적 연산
 * 하나로 승자가 하나만 나온다.
 *   1. 다 쓴 임시 파일을 `link` 로 올린다 — 잠금이 없으면 하나만 성공한다.
 *   2. 있으면 읽는다(읽는 사이 놓였으면 1 을 한 번 더). 깨졌거나 pid 가 살아 있으면 잡힌 것으로 본다
 *      (자기 pid 는 재시작으로 다시 쓰인 것이라 죽은 것으로 본다).
 *   3. pid 가 죽었으면 읽은 token T 로 회수 권리 파일(`reclaim.<T>`)을 새로 만든다(`wx`) — 하나만 만든다.
 *   4. 잠금을 다시 읽어 token 이 여전히 T 인지 본다. 다르면 물러난다.
 *   5. `rename` 으로 잠금을 덮어쓴다(잠금이 없는 순간이 없다). 그 뒤 권리 파일을 지운다.
 * 놓을 때 띄운 Chrome 이 끝난 것을 확인하지 못했으면 잠금을 그 Chrome pid·새 token 으로 바꿔 둔다(releaseBrowserOwner).
 * 3~5 사이에 회수하던 프로세스가 죽으면 아무도 주인이 되지 않는다(주인이 둘이 아니라 없는 쪽으로 실패).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { BROWSER_OWNER_LOCK, browserOwnerReclaimName, browserOwnerTmpName } from './config';

export type BrowserOwnerResult = { owned: true; token: string } | { owned: false; message: string };

/** 테스트 주입 훅 — 단계 사이에 다른 프로세스의 진행을 끼워 넣는다. */
interface BrowserOwnerHooks {
    beforeRead?: () => void;
    afterRead?: () => void;
    afterReclaim?: () => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 형식이 맞는 잠금 내용만 돌려준다. 없으면 'missing', 읽지 못하거나 형식이 다르면 null. */
function readLock(file: string): { pid: number; token: string } | 'missing' | null {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : null;
    }
    try {
        const v = JSON.parse(raw) as { pid?: unknown; token?: unknown };
        if (Number.isInteger(v.pid) && (v.pid as number) > 0 && typeof v.token === 'string' && UUID_RE.test(v.token)) {
            return { pid: v.pid as number, token: v.token };
        }
    } catch { /* 형식이 다름 */ }
    return null;
}

function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (e) {
        return (e as NodeJS.ErrnoException).code !== 'ESRCH'; // 권한 오류(EPERM)는 살아 있음
    }
}

/** `dir`(보통 ~/.openmake) 의 브라우저 주인 잠금을 잡는다. 못 잡으면 터미널에 보일 문구를 돌려준다. */
export function acquireBrowserOwner(dir: string, hooks: BrowserOwnerHooks = {}): BrowserOwnerResult {
    const lock = path.join(dir, BROWSER_OWNER_LOCK);
    const token = crypto.randomUUID();
    const tmp = path.join(dir, browserOwnerTmpName(token));
    const off = (why: string, files = lock): BrowserOwnerResult => ({ owned: false, message: `이 연결에서는 브라우저를 끕니다 — ${why} (${files})` });
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, token }));
        // 올리기에 진 직후 주인이 잠금을 놓았으면(읽으니 없다) 한 번 더 올린다.
        let held: ReturnType<typeof readLock> = 'missing';
        for (let attempt = 0; attempt < 2 && held === 'missing'; attempt++) {
            try {
                fs.linkSync(tmp, lock);
                return { owned: true, token };
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            }
            hooks.beforeRead?.();
            held = readLock(lock);
        }
        hooks.afterRead?.();
        if (held === 'missing') return off('브라우저 주인 잠금이 잡혔다 놓이기를 되풀이합니다. 다시 실행하세요');
        if (held === null) return off('브라우저 주인 잠금 파일을 읽지 못했습니다');
        // 자기 pid 가 남아 있으면 재시작으로 pid 가 다시 쓰인 것이다(잡기 전이라 이 프로세스의 잠금일 수 없다).
        if (held.pid !== process.pid && isAlive(held.pid)) return off(`브라우저는 다른 openmake-code(pid ${held.pid})가 쓰고 있습니다`);

        const reclaim = path.join(dir, browserOwnerReclaimName(held.token));
        try { fs.closeSync(fs.openSync(reclaim, 'wx')); } catch {
            return off('남은 브라우저 주인 잠금을 회수하지 못했습니다. 회수하던 프로세스가 중간에 끝났다면 두 파일을 지우고 다시 실행하세요', `${lock}, ${reclaim}`);
        }
        hooks.afterReclaim?.();
        const again = readLock(lock);
        if (again === 'missing' || again === null || again.token !== held.token) {
            fs.rmSync(reclaim, { force: true });
            return off('다른 openmake-code 가 먼저 브라우저를 맡았습니다');
        }
        fs.renameSync(tmp, lock);
        fs.rmSync(reclaim, { force: true });
        return { owned: true, token };
    } catch (e) {
        return off(`브라우저 주인 잠금을 잡지 못했습니다: ${(e as Error).message}`);
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}

/**
 * 잠금에 자기 token 이 남아 있을 때만 지운다(동기 — process 'exit' 에서 부른다).
 * 띄운 Chrome 이 끝난 것을 확인하지 못했으면(`lingeringPid`) 지우지 않고 그 pid·새 token 으로 바꿔 쓴다 — 새 CLI 는
 * 그 Chrome 이 살아 있는 동안 물러나고, 끝나면 죽은 주인으로 보고 회수한다.
 */
export function releaseBrowserOwner(dir: string, token: string, lingeringPid?: number): void {
    const lock = path.join(dir, BROWSER_OWNER_LOCK);
    const held = readLock(lock);
    if (held === 'missing' || held === null || held.token !== token) return;
    if (lingeringPid === undefined) {
        try { fs.unlinkSync(lock); } catch { /* 이미 없음 */ }
        return;
    }
    // 새 token 으로 넘긴다 — 넘기기 전에 옛 잠금을 읽은 회수자가 token 재확인을 통과하지 못하게(token 은 다시 쓰이지 않는다).
    const next = crypto.randomUUID();
    const tmp = path.join(dir, browserOwnerTmpName(next));
    try {
        fs.writeFileSync(tmp, JSON.stringify({ pid: lingeringPid, token: next }));
        fs.renameSync(tmp, lock);
    } catch { fs.rmSync(tmp, { force: true }); }
}
