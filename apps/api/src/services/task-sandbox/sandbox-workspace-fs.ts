/**
 * Task Sandbox workspace 파일시스템 — sandbox.ts 에서 분리 (max-lines 가드).
 * workspace 경로 가드(어휘·실경로)·사용량 합산·파일 나열.
 *
 * @module services/task-sandbox/sandbox-workspace-fs
 */
import { readdir, stat, lstat, realpath } from 'fs/promises';
import { resolve, sep, join, dirname, basename, relative } from 'path';
import { stripWorkspacePrefix } from './workspace-path';

/**
 * PURE: workspace 내부로만 해석되는 안전 경로 반환 (유닛테스트 대상).
 * `..`/절대경로 표기 탈출을 차단하는 **어휘적(1차)** 가드 — 심링크는 해석하지 않으므로
 * 실제 파일 I/O 전에는 반드시 safeRealWorkspacePath 로 실경로까지 검증할 것.
 *
 * 컨테이너 절대경로(`/workspace/...`)는 **탈출이 아니라 같은 파일의 다른 표기**다. 에이전트는
 * 컨테이너 안에서 bash 로 작업하므로 `/workspace/data.json` 이 눈에 보이는 정확한 경로이고,
 * 실제로 그렇게 쓴다 — 그런데 이 검사는 호스트 경로(hostWorkdir) 기준이라 탈출로 판정했다.
 * 2026-07-22 ~ 08-02 사이 예약 리포트가 `/workspace/data.json`·`/workspace/report.html` 로
 * 반복 차단당하며 턴을 낭비했고, 08-03 실행은 마지막 턴에 이 차단을 맞아 재시도할 턴이 없어
 * 리포트 없이 끝났다. 마운트 지점을 상대경로로 정규화해 같은 대상을 같게 해석한다.
 * 정규화 뒤에도 검사는 그대로 적용되므로 `/workspace/../etc/passwd` 는 여전히 차단된다.
 */
export function safeResolveWorkspacePath(hostWorkdir: string, userPath: string): string {
    const root = resolve(hostWorkdir);
    const normalized = stripWorkspacePrefix(userPath);
    const abs = resolve(root, normalized);
    if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(
            `workspace 경로 탈출 차단: ${userPath}`
            + ' (파일 도구는 /workspace 내부만 접근 가능 — /opt/... 같은 컨테이너 경로는'
            + ' bash 로 `cp -r <경로> ./` 하여 workspace 에 복사한 뒤 사본을 여세요)',
        );
    }
    return abs;
}

/**
 * workspace 내부로만 해석되는 안전 **실경로** 반환 — 심링크 탈출 차단(2차 가드).
 *
 * 컨테이너의 bash 가 bind-mount 안에 호스트 경로를 가리키는 심링크를 만들 수 있고,
 * 파일 I/O(fs.readFile/writeFile/rm)와 res.download 는 호스트에서 심링크를 따라가므로
 * 어휘적 검사만으로는 호스트 임의 파일 읽기/쓰기로 탈출한다. 여기서는 대상 경로의
 * 가장 깊은 실존 조상을 realpath 로 해석해 그 실경로가 workspace 실경로 내부인지
 * 강제한다(미실존 꼬리 세그먼트는 실존 조상의 실경로에 다시 붙여 반환).
 */
export async function safeRealWorkspacePath(hostWorkdir: string, userPath: string): Promise<string> {
    const abs = safeResolveWorkspacePath(hostWorkdir, userPath);
    const realRoot = await realpath(resolve(hostWorkdir));
    let probe = abs;
    let rest = '';
    for (;;) {
        let real: string | null = null;
        try {
            real = await realpath(probe);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
            // realpath ENOENT 는 "경로 없음" 과 "대상이 없는 심링크" 를 구분하지 못한다. 후자를 미실존으로
            // 넘기면 부모 실경로 + 이름으로 통과해 writeFile 이 링크를 따라 밖에 파일을 만든다(2026-09-06).
            if (await lstat(probe).then(() => true, () => false)) {
                throw new Error(`workspace 경로 탈출 차단(symlink): ${userPath}`);
            }
            const parent = dirname(probe);
            if (parent === probe) throw e; // 파일시스템 루트까지 미실존 — 비정상
            rest = rest ? join(basename(probe), rest) : basename(probe);
            probe = parent;
            continue;
        }
        const mapped = rest ? join(real, rest) : real;
        if (mapped !== realRoot && !mapped.startsWith(realRoot + sep)) {
            throw new Error(`workspace 경로 탈출 차단(symlink): ${userPath}`);
        }
        return mapped;
    }
}

/**
 * 디렉토리 사용량(byte) 재귀 합산 — workspace 디스크 쿼터 검사용.
 * cap 초과가 확정되면 조기 중단한다(반환값은 "cap 이상" 판정에만 유효).
 * 심링크는 따라가지 않는다(Dirent 는 심링크를 file/dir 로 분류하지 않음).
 */
export async function dirSizeBytes(root: string, cap = Number.MAX_SAFE_INTEGER): Promise<number> {
    let total = 0;
    async function walk(dir: string): Promise<void> {
        if (total >= cap) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (total >= cap) return;
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else if (e.isFile()) {
                try { total += (await stat(full)).size; } catch { /* 삭제 경합 등 — 무시 */ }
            }
        }
    }
    await walk(resolve(root));
    return total;
}

/**
 * 주어진 workspace 디렉토리의 전체 파일을 상대경로로 재귀 나열 (산출물 다운로드 엔드포인트용).
 * 라이브 TaskSandbox 인스턴스 없이도 동작(task 완료 후 workspace_path 로 호출).
 * **숨김 파일/디렉토리(dotfile) 제외** — `.git`(diff 캡처 메타), `.verify_*.py`(코드검증 임시),
 * 기타 시스템 dotfile 이 산출물 목록에 새어 "이상한 파일" 로 다운로드되던 것을 막는다.
 */
export async function listWorkspaceFilesAt(root: string, maxFiles = 1000, strict = false): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        if (out.length >= maxFiles) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (strict) throw e; return; }
        for (const e of entries) {
            if (out.length >= maxFiles) return;
            if (e.name.startsWith('.')) continue; // 숨김 파일/디렉토리(.git·.verify_* 등) 제외
            const full = join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else {
                out.push(relative(root, full));
            }
        }
    }
    await walk(resolve(root));
    return out.sort();
}
