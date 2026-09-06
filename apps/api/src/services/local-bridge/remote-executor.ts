/**
 * ============================================================
 * Remote Executor — 로컬 브리지 경유 TaskExecutor 구현 (Cowork D1a)
 * ============================================================
 *
 * Agent Task 의 도구 호출을 연결된 디바이스(사용자 머신)로 위임한다.
 * 경로 스코프 강제는 디바이스측이 1차(realpath), 서버는 요청 형태만 고정(임의 RPC 금지).
 *
 * 샌드박스와의 차이:
 *   - localWorkdir=null → 호스트측 git 연산(diff/clone/PR)·파일 다운로드 미지원(가드로 skip)
 *   - runBrowser 미지원(D1) · cleanup 은 task_end 통지만 — **사용자 폴더를 삭제하지 않는다**
 *
 * @module services/local-bridge/remote-executor
 */
import type { TaskExecutor, ExecResult, CodeNavSpec, CodeNavData } from '../task-sandbox/executor';
import { getLocalBridgeRegistry, type BridgeResult, type BridgeRequestPayload } from './registry';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { readFile as fsReadFile, stat } from 'fs/promises';
import { createLogger } from '../../utils/logger';

const logger = createLogger('RemoteExecutor');

function toExecResult(r: BridgeResult): ExecResult {
    return {
        stdout: (r.stdout ?? '').slice(0, LOCAL_BRIDGE.OUTPUT_CAP),
        stderr: (r.ok ? (r.stderr ?? '') : (r.error ?? r.stderr ?? '로컬 실행 실패')).slice(0, LOCAL_BRIDGE.OUTPUT_CAP),
        exitCode: r.ok ? (r.exitCode ?? 0) : (r.exitCode ?? -1),
        truncated: (r.stdout?.length ?? 0) > LOCAL_BRIDGE.OUTPUT_CAP,
        timedOut: false,
        durationMs: r.durationMs ?? 0,
    };
}

export class RemoteExecutor implements TaskExecutor {
    readonly taskId: string;
    readonly localWorkdir = null;
    /**
     * 로컬 브라우저(D3) 폐기 — 항상 false (2026-08-23). 이 기능을 구현하던 것은 Electron
     * 데스크톱 셸뿐이었고 그 앱이 제거되면서 구현 디바이스가 사라졌다(Companion·CLI 는
     * 애초에 미지원). tools.ts 의 browser 핸들러가 진입 단계에서 막으므로 에이전트는
     * 로컬 실행 작업에서 브라우저 도구를 쓸 수 없다 — 컨테이너 샌드박스 경로는 무관하게 유지된다.
     */
    readonly isBrowserEnabled = false;
    readonly browserStatePath = null;
    private readonly userId: string;
    /** 라우팅 대상 디바이스(101, 다중 디바이스) — undefined 는 최근 접속 디바이스 폴백. */
    private readonly deviceId?: string;
    private deviceLabel = 'local-device';
    /**
     * worktree 격리 시 연결 폴더 기준 상대경로(예: `.openmake/worktrees/<taskId>`). null 이면
     * 격리 없이 연결 폴더에서 직접 작업하는 기존 동작이다(git 레포가 아니거나 생성 실패).
     */
    private worktreeRel: string | null = null;
    /** worktree 작업 브랜치명 — 사용자 안내·결과 보고용. */
    private worktreeBranch: string | null = null;

    /**
     * 폴더 선택(102) — 연결 루트 기준 상대경로. 지정 시 모든 브리지 요청에 folder 로 첨부되어
     * 디바이스가 exec cwd·파일 경로·worktree base 를 이 하위 폴더로 재지정한다. undefined=루트.
     */
    private readonly folderRel?: string;

    constructor(taskId: string, userId: string, deviceId?: string, folderRel?: string) {
        this.taskId = taskId;
        this.userId = userId;
        this.deviceId = deviceId;
        this.folderRel = folderRel;
    }

    get label(): string { return `local:${this.deviceLabel}`; }

    /** worktree 격리가 실제로 적용됐는지(호출부 안내·diff 캡처 판단용). */
    get isolatedBranch(): string | null { return this.worktreeBranch; }

    /**
     * 실행 준비 = 디바이스 연결 확인 + worktree 격리 시도.
     * 미연결이면 throw → 호출부 graceful degrade. worktree 실패는 throw 하지 않는다(fail-open).
     */
    async create(): Promise<void> {
        const dev = getLocalBridgeRegistry().getDevice(this.userId, this.deviceId);
        if (!dev) throw new Error('연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 먼저 연결하세요.');
        this.deviceLabel = `${dev.label}`;
        // folderRel(폴더 선택, 102)까지 남긴다 — 로그만으로 "어느 폴더에서 돌았는지" 추적 가능해야
        // 한다(DB folder_rel 조회 없이 사고 분석·감사가 되도록).
        logger.info(`[${this.taskId}] 로컬 실행기 준비 (device=${dev.deviceId}, folder="${dev.folderName}"${this.folderRel ? `/${this.folderRel}` : ''})`);

        if (!LOCAL_BRIDGE.WORKTREE_ENABLED) return;
        const r = await this.req({ kind: 'worktree', op: 'add', taskId: this.taskId });
        if (r.ok && r.worktreeRel) {
            this.worktreeRel = r.worktreeRel;
            this.worktreeBranch = r.branch ?? null;
            logger.info(`[${this.taskId}] worktree 격리 활성 (${r.worktreeRel}, branch=${r.branch})`);
        } else {
            // git 레포가 아니거나 생성 실패 — 격리 없이 진행한다(기존 동작 유지).
            logger.info(`[${this.taskId}] worktree 격리 미적용: ${r.error ?? 'worktreeRel 없음'}`);
        }
    }

    private req(payload: BridgeRequestPayload, timeoutMs?: number): Promise<BridgeResult> {
        const withFolder = this.folderRel ? { ...payload, folder: this.folderRel } : payload;
        return getLocalBridgeRegistry().request(this.userId, withFolder, timeoutMs, this.deviceId);
    }

    /**
     * 편집 후 진단 — 디바이스에서 컴파일러(tsc/py_compile)를 돌려 방금 고친 파일의 오류를 받는다.
     * 모델에 새 도구를 노출하지 않고 write 계열 도구 결과에 덧붙이는 용도(plan 1단계).
     *
     * 다음은 모두 **null**(호출측이 조용히 생략, fail-open):
     *   게이트 OFF · 구 디바이스(kind 미지원) · 타임아웃/오류 · 지원 도구 없음(serverKind='none')
     * 진단 0건은 null 이 아니라 "진단 없음" 텍스트로 돌려준다 — 모델이 검사 결과를 신뢰할 수 있게.
     */
    async diagnostics(relPaths: string[]): Promise<{ text: string; count: number } | null> {
        if (!LOCAL_BRIDGE.LSP_ENABLED || relPaths.length === 0) return null;
        const r = await this.req(
            { kind: 'lsp_diagnostics', paths: relPaths.map((p) => this.scoped(p)) },
            LOCAL_BRIDGE.LSP_TIMEOUT_MS,
        ).catch(() => ({ ok: false }) as BridgeResult);
        if (!r.ok || !Array.isArray(r.diagnostics)) return null;      // 미지원·실패 → 생략
        if (r.serverKind === 'none') return null;                     // 검사 도구 없음 → 생략
        if (r.diagnostics.length === 0) return { text: '[진단 없음]', count: 0 };
        // worktree prefix 는 모델이 쓰는 상대경로가 아니므로 떼어낸다(도구 인자와 표기 일치).
        const strip = (p: string): string =>
            this.worktreeRel && p.startsWith(`${this.worktreeRel}/`) ? p.slice(this.worktreeRel.length + 1) : p;
        const lines = r.diagnostics.map((d) =>
            `${strip(d.path)}:${d.line}:${d.col} ${d.severity}${d.code ? ` ${d.code}` : ''}: ${d.message}`);
        const head = `[진단 ${r.diagnostics.length}건${r.truncated ? '+' : ''} — ${r.serverKind}]`;
        return { text: `${head}\n${lines.join('\n')}`, count: r.diagnostics.length };
    }

    /**
     * 코드 탐색(grep_code·repo_map) — 디바이스가 셸 없이 파일을 훑어 결과만 돌려준다.
     * exec 로 내보내면 읽기 전용인데도 confirmExec 승인 창이 매 호출 떠서 실사용이 불가능하다
     * (lsp_diagnostics 와 같은 취지의 전용 kind). 구 디바이스는 "지원하지 않는 kind" 오류를
     * 돌려주므로 **null** → 호출측(tools-code-nav)이 셸 경로로 폴백한다.
     */
    async codeNav(spec: CodeNavSpec): Promise<CodeNavData | null> {
        const r = await this.req({
            kind: 'code_nav',
            op: spec.op,
            path: this.scoped(spec.path ?? '.'),
            ...(spec.pattern ? { pattern: spec.pattern } : {}),
            ...(spec.glob ? { glob: spec.glob } : {}),
            ...(spec.ignoreCase ? { ignoreCase: true } : {}),
            ...(spec.maxResults ? { maxResults: spec.maxResults } : {}),
        }).catch(() => ({ ok: false }) as BridgeResult);
        if (!r.ok || !r.codeNav) {
            logger.info(`[${this.taskId}] code_nav 미지원·실패 — 셸 경로로 폴백: ${r.error ?? 'codeNav 없음'}`);
            return null;
        }
        // worktree prefix 는 모델이 쓰는 상대경로가 아니라 떼어낸다(diagnostics 와 같은 규칙).
        const strip = (p: string): string =>
            this.worktreeRel && p.startsWith(`${this.worktreeRel}/`) ? p.slice(this.worktreeRel.length + 1) : p;
        return {
            ...(r.codeNav.matches ? { matches: r.codeNav.matches.map(strip) } : {}),
            ...(r.codeNav.files ? { files: r.codeNav.files.map((f) => ({ ...f, path: strip(f.path) })) } : {}),
            ...(r.codeNav.truncated ? { truncated: true } : {}),
        };
    }

    /** 파일 경로를 worktree 기준으로 변환. 격리가 없으면 원래 경로 그대로. */
    private scoped(relPath: string): string {
        if (!this.worktreeRel) return relPath;
        const clean = (relPath ?? '.').replace(/^\.\/+/, '');
        return clean === '' || clean === '.' ? this.worktreeRel : `${this.worktreeRel}/${clean}`;
    }

    async exec(command: string): Promise<ExecResult> {
        // 디바이스는 cwd=연결 폴더로 실행하므로, 격리 시 worktree 로 이동해 수행한다.
        // (감싼 문자열이 사용자 확인 창에 그대로 보이므로 어디서 실행되는지 투명하다.)
        const scopedCommand = this.worktreeRel ? `cd ${this.worktreeRel} && ${command}` : command;
        // taskId 를 함께 보낸다 — 디바이스가 승인 게이트를 **작업 단위**로 일괄 처리할 수 있게
        // (에이전트 작업 하나가 셸 명령을 수십 번 부르므로 매번 확인은 실사용이 어렵다).
        return toExecResult(await this.req({ kind: 'exec', command: scopedCommand, taskId: this.taskId }));
    }

    /**
     * worktree 변경분 diff — 레포의 실제 HEAD 가 기준점이라 인위적 baseline 커밋이 필요 없다.
     * 격리가 없거나 실패하면 null(호출부는 diff 스텝을 남기지 않는다).
     */
    async captureDiff(): Promise<string | null> {
        if (!this.worktreeRel) return null;
        const r = await this.req({ kind: 'worktree', op: 'diff', taskId: this.taskId });
        if (!r.ok) {
            logger.warn(`[${this.taskId}] worktree diff 실패: ${r.error}`);
            return null;
        }
        const out = (r.stdout ?? '').slice(0, LOCAL_BRIDGE.OUTPUT_CAP);
        return out.trim() === '' ? null : out;
    }

    /**
     * 폐기된 로컬 브라우저(D3) — TaskExecutor 계약을 만족시키기 위한 거절 스텁.
     * isBrowserEnabled=false 라 tools.ts 가 먼저 막지만, 다른 경로로 호출돼도 브리지에
     * browser 요청을 내보내지 않는다(프로토콜 kind 화이트리스트에서도 제거됨).
     */
    async runBrowser(_actionsRelPath: string): Promise<ExecResult> {
        return {
            stdout: '', exitCode: -1, truncated: false, timedOut: false, durationMs: 0,
            stderr: '로컬 실행기는 브라우저를 지원하지 않습니다 (2026-08-23 폐기). 서버 샌드박스 작업으로 실행하세요.',
        };
    }

    async writeFile(relPath: string, content: string | Buffer): Promise<void> {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        if (buf.byteLength > LOCAL_BRIDGE.MAX_WRITE_BYTES) {
            throw new Error(`파일이 너무 큽니다 (${buf.byteLength}b > ${LOCAL_BRIDGE.MAX_WRITE_BYTES}b)`);
        }
        const r = await this.req({ kind: 'write', path: this.scoped(relPath), contentB64: buf.toString('base64') });
        if (!r.ok) throw new Error(r.error ?? '로컬 파일 쓰기 실패');
    }

    /** 호스트 파일(입력 첨부 스풀)을 읽어 브리지로 전송 — 캡 초과는 거부. */
    async importFile(relPath: string, srcAbsPath: string): Promise<void> {
        const st = await stat(srcAbsPath);
        if (st.size > LOCAL_BRIDGE.MAX_WRITE_BYTES) {
            throw new Error(`첨부가 로컬 전송 상한을 초과합니다 (${st.size}b > ${LOCAL_BRIDGE.MAX_WRITE_BYTES}b)`);
        }
        await this.writeFile(relPath, await fsReadFile(srcAbsPath));
    }

    async readFile(relPath: string): Promise<string> {
        const r = await this.req({ kind: 'read', path: this.scoped(relPath) });
        if (!r.ok) throw new Error(r.error ?? '로컬 파일 읽기 실패');
        return (r.content ?? '').slice(0, LOCAL_BRIDGE.OUTPUT_CAP);
    }

    async listDir(relPath = '.'): Promise<string[]> {
        const r = await this.req({ kind: 'list', path: this.scoped(relPath) });
        if (!r.ok) throw new Error(r.error ?? '로컬 디렉토리 조회 실패');
        return r.entries ?? [];
    }

    /** listAll 은 연결 폴더 전체를 훑으므로, 격리 시 worktree 하위만 남기고 prefix 를 벗긴다. */
    async listWorkspaceFiles(): Promise<string[]> {
        const r = await this.req({ kind: 'listAll' });
        const all = r.ok ? (r.entries ?? []) : [];
        if (!this.worktreeRel) return all;
        const prefix = `${this.worktreeRel}/`;
        return all.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
    }

    async deleteFile(relPath: string): Promise<void> {
        const r = await this.req({ kind: 'delete', path: this.scoped(relPath) });
        if (!r.ok) throw new Error(r.error ?? '로컬 파일 삭제 실패');
    }

    /**
     * 종료 통지 + worktree 정리 — 사용자 폴더는 절대 삭제하지 않는다(removeWorkspace 무시).
     * worktree 도 **변경분이 없을 때만** 제거한다(디바이스가 판단). 변경이 남아 있으면 브랜치와
     * 함께 보존해 사용자가 검토·머지할 수 있게 한다.
     */
    async cleanup(): Promise<void> {
        if (this.worktreeRel) {
            const r = await this.req({ kind: 'worktree', op: 'remove', taskId: this.taskId })
                .catch(() => ({ ok: false } as BridgeResult));
            if (r.ok) {
                logger.info(`[${this.taskId}] worktree ${r.kept ? `보존 (branch=${this.worktreeBranch})` : '정리 완료'}`);
            }
        }
        // taskId 포함 — 디바이스가 이 작업의 일괄 승인을 즉시 회수한다.
        await this.req({ kind: 'task_end', taskId: this.taskId }).catch(() => { /* best-effort */ });
        logger.info(`[${this.taskId}] 로컬 실행기 세션 종료 통지`);
    }
}
