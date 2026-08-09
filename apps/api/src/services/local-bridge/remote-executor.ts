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
import type { TaskExecutor, ExecResult } from '../task-sandbox/executor';
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
     * D3 — 로컬 브라우저 게이트. 서버 샌드박스의 TASK_SANDBOX_BROWSER_ENABLED 와 **별개**로
     * LOCAL_BRIDGE_BROWSER_ENABLED 를 본다. false 면 tools.ts 의 browser 핸들러가 진입 단계에서
     * 막으므로 runBrowser 까지 오지 않는다(D1 시절 하드코딩 false 로 인해 실제로 그랬다).
     */
    readonly isBrowserEnabled = LOCAL_BRIDGE.BROWSER_ENABLED;
    /** 세션 영속은 데스크톱 파티션(persist:openmake-agent)이 담당 — 서버측 상태 파일 불필요. */
    readonly browserStatePath = null;
    private readonly userId: string;
    private deviceLabel = 'local-device';
    /**
     * worktree 격리 시 연결 폴더 기준 상대경로(예: `.openmake/worktrees/<taskId>`). null 이면
     * 격리 없이 연결 폴더에서 직접 작업하는 기존 동작이다(git 레포가 아니거나 생성 실패).
     */
    private worktreeRel: string | null = null;
    /** worktree 작업 브랜치명 — 사용자 안내·결과 보고용. */
    private worktreeBranch: string | null = null;

    constructor(taskId: string, userId: string) {
        this.taskId = taskId;
        this.userId = userId;
    }

    get label(): string { return `local:${this.deviceLabel}`; }

    /** worktree 격리가 실제로 적용됐는지(호출부 안내·diff 캡처 판단용). */
    get isolatedBranch(): string | null { return this.worktreeBranch; }

    /**
     * 실행 준비 = 디바이스 연결 확인 + worktree 격리 시도.
     * 미연결이면 throw → 호출부 graceful degrade. worktree 실패는 throw 하지 않는다(fail-open).
     */
    async create(): Promise<void> {
        const dev = getLocalBridgeRegistry().getDevice(this.userId);
        if (!dev) throw new Error('연결된 로컬 디바이스가 없습니다 — 데스크톱 앱에서 작업 폴더를 먼저 연결하세요.');
        this.deviceLabel = `${dev.label}`;
        logger.info(`[${this.taskId}] 로컬 실행기 준비 (device=${dev.deviceId}, folder="${dev.folderName}")`);

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

    private req(payload: BridgeRequestPayload): Promise<BridgeResult> {
        return getLocalBridgeRegistry().request(this.userId, payload);
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
        return toExecResult(await this.req({ kind: 'exec', command: scopedCommand }));
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
     * 로컬 브라우저 실행(D3a) — 데스크톱 Electron 내장 Chromium 에서 액션을 수행한다.
     *
     * 컨테이너 경로(`browser-runner.mjs`)와 **출력 계약을 동일**하게 맞춘다
     * (`{ok, finalUrl, results[]}` JSON 을 stdout 으로) — 서버측 파싱·프롬프트를 재사용하기 위함.
     * 액션 spec 은 에이전트가 워크스페이스(=사용자 폴더)에 써둔 JSON 이므로 브리지 read 로 가져온다.
     */
    async runBrowser(actionsRelPath: string): Promise<ExecResult> {
        if (!LOCAL_BRIDGE.BROWSER_ENABLED) {
            return {
                stdout: '', exitCode: -1, truncated: false, timedOut: false, durationMs: 0,
                stderr: '로컬 브라우저가 비활성화되어 있습니다 (LOCAL_BRIDGE_BROWSER_ENABLED=false).',
            };
        }
        let spec: unknown;
        try {
            spec = JSON.parse(await this.readFile(actionsRelPath));
        } catch (e) {
            return {
                stdout: '', exitCode: -1, truncated: false, timedOut: false, durationMs: 0,
                stderr: `브라우저 액션 파일을 읽지 못했습니다 (${actionsRelPath}): ${e instanceof Error ? e.message : String(e)}`,
            };
        }
        // timeout 은 서버 상한으로 고정 — 액션 파일이 제시한 값을 그대로 믿지 않는다.
        return toExecResult(await this.req({
            kind: 'browser',
            spec: { ...(spec as Record<string, unknown>), timeoutMs: LOCAL_BRIDGE.BROWSER_TIMEOUT_MS },
        }));
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
        await this.req({ kind: 'task_end' }).catch(() => { /* best-effort */ });
        logger.info(`[${this.taskId}] 로컬 실행기 세션 종료 통지`);
    }
}
