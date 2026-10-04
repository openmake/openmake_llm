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
import { stripWorkspacePrefix } from '../task-sandbox/workspace-path';
import { getLocalBridgeRegistry, type BridgeKind, type BridgeResult, type BridgeRequestPayload } from './registry';
import { getLocalBridgeUnknownOutcomeNotice } from '../../prompts/agent-task-prompt';
import { LocalDeviceUnavailableError, type DeviceLoss } from './device-errors';
import { classifyBrowserAction, planBrowserActions, type BrowserSitePlan } from '@openmake/config';
import { resolveEffectivePolicy } from '../org/effective-policy';
import { LOCAL_BRIDGE } from '../../config/local-bridge';
import { readFile as fsReadFile, stat } from 'fs/promises';
import { createLogger } from '../../utils/logger';

const logger = createLogger('RemoteExecutor');

/** 응답 없이 끝나면 "결과 불명"으로 다루는 요청 종류 — 기기의 상태를 바꾸는 것(쓰기·실행). 나머지는 읽기라 재시도 가능. */
const UNKNOWN_OUTCOME_KINDS: ReadonlySet<BridgeKind> = new Set<BridgeKind>(['exec', 'write', 'delete']);

/** PURE: 이 요청이 응답 없이 끝나면 결과 불명인가 — 쓰기·실행, 그리고 읽기가 아닌 액션이 든 브라우저 요청. */
function isUnknownOutcomeRequest(payload: BridgeRequestPayload): boolean {
    if (payload.kind === 'browser') return (payload.actions ?? []).some((a) => classifyBrowserAction(a) !== 'observe');
    return UNKNOWN_OUTCOME_KINDS.has(payload.kind);
}

/** 디바이스가 돌려줄 수 있는 test_runner 값 — 그 밖의 문자열은 믿지 않는다. */
const TEST_RUNNER_TOKENS: readonly string[] = ['npm', 'pytest', 'go', 'none'];

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
     * 로컬 브라우저(Companion P2, 2026-10-04 재도입) — 게이트(LOCAL_BRIDGE_BROWSER_ENABLED)가 켜져 있고 연결된 기기가
     * 능력 목록에 browser 를 알렸을 때만 참이다. 구버전 Companion·CLI 는 알리지 않으므로 도구가 노출되지 않는다.
     * (2026-08-23 에 폐기됐던 것은 구 Electron 앱의 구현이다 — 지금은 공용 코어가 전용 프로필 Chrome 을 CDP 로 제어한다.)
     */
    get isBrowserEnabled(): boolean {
        return LOCAL_BRIDGE.BROWSER_ENABLED && getLocalBridgeRegistry().supports(this.userId, this.deviceId, 'browser');
    }
    /** 로그인 상태는 기기의 전용 프로필에 남는다 — 서버가 상태 파일을 다루지 않는다. */
    readonly browserStatePath = null;
    /** 기기가 마지막으로 알려 준 탭 주소 — 다음 호출의 사이트 정책 판정 시작점. 기기는 실제 주소로 다시 판정한다. */
    private lastBrowserUrl: string | null = null;
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
    private deviceLoss: DeviceLoss | null = null;

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
        if (!dev) throw new LocalDeviceUnavailableError();
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

    private async req(payload: BridgeRequestPayload, timeoutMs?: number): Promise<BridgeResult> {
        const withFolder = this.folderRel ? { ...payload, folder: this.folderRel } : payload;
        const r = await getLocalBridgeRegistry().request(this.userId, withFolder, timeoutMs, this.deviceId);
        this.noteDeviceLoss(isUnknownOutcomeRequest(payload), r);
        // 쓰기·실행 요청을 보낸 뒤 응답을 못 받았다 — 기기에서 실행됐을 수 있다. 일반 오류로 돌려주면 모델이 같은 호출을
        // 다시 보내 두 번 실행될 수 있으므로, 상태부터 확인하라는 안내로 바꾼다. 읽기 계열은 다시 시도해도 되므로 그대로 둔다.
        if (!r.ok && isUnknownOutcomeRequest(payload) && (r.transport === 'timeout' || r.transport === 'disconnected')) {
            logger.warn(`[${this.taskId}] 로컬 ${payload.kind} 결과 불명 (${r.transport})`);
            return { ...r, error: getLocalBridgeUnknownOutcomeNotice(payload.kind, r.transport) };
        }
        return r;
    }

    /** 기기가 사라져 끝난 요청을 기억한다 — unknown(쓰기·실행을 보낸 뒤 끊김)이 rerunnable 보다 우선한다. */
    private noteDeviceLoss(unknownOutcome: boolean, r: BridgeResult): void {
        if (r.ok || !LOCAL_BRIDGE.DEVICE_WAIT_ENABLED) return;
        if (r.transport === 'disconnected' && unknownOutcome) this.deviceLoss = 'unknown';
        else if ((r.transport === 'no_device' || r.transport === 'send_failed' || r.transport === 'disconnected') && this.deviceLoss !== 'unknown') this.deviceLoss = 'rerunnable';
    }

    /**
     * 마지막으로 읽은 뒤 기기가 사라져 끝난 요청이 있었는가 — 읽으면 지워진다. 턴 실행기가 도구 호출마다 읽어
     * 기기 대기 주차를 판단한다(agent-task/device-wait). 시간 초과는 포함하지 않는다(기기는 연결돼 있다).
     */
    consumeDeviceLoss(): DeviceLoss | null {
        const loss = this.deviceLoss;
        this.deviceLoss = null;
        return loss;
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
            ...(r.codeNav.skipped ? { skipped: r.codeNav.skipped } : {}),
        };
    }

    /**
     * 테스트 러너 탐지 — 디바이스가 셸 없이 폴더를 보고 답한다(확인 창 없음). 격리 중이면 worktree 에서 본다.
     * 구 디바이스("지원하지 않는 kind")·실패·모르는 값은 **null** → 호출측이 셸 프로브로 폴백한다.
     */
    async detectTestRunner(): Promise<string | null> {
        const r = await this.req({ kind: 'test_runner', path: this.scoped('.') }).catch(() => ({ ok: false }) as BridgeResult);
        return r.ok && r.testRunner && TEST_RUNNER_TOKENS.includes(r.testRunner) ? r.testRunner : null;
    }

    /**
     * 승인 대기 알림 — 이 작업을 실행 중인 디바이스로 bridge_notice 를 보낸다(컴패니언이 네이티브
     * 알림으로 띄움). 단방향이라 결과를 기다리지 않고, 미연결은 조용히 넘긴다. 구 디바이스는 모르는
     * type 을 무시하므로 추가 전용으로 안전하다.
     */
    notifyApprovalPending(toolName: string): void {
        const sent = getLocalBridgeRegistry().notify(this.userId, { notice: 'approval_pending', taskId: this.taskId, toolName }, this.deviceId);
        logger.info(`[${this.taskId}] 승인 대기 알림 → 디바이스 ${sent ? '전송' : '미전송(연결 없음)'}: ${toolName}`);
    }

    /**
     * 파일 경로를 디바이스 요청 경로로 변환. 컨테이너 표기(`/workspace/...`)는 연결 폴더 기준 상대경로로
     * 풀고(샌드박스 safeResolveWorkspacePath 와 같은 규칙 — 안 풀면 디바이스가 "폴더 스코프 밖"으로 거부한다),
     * 격리 중이면 worktree 기준으로 옮긴다.
     */
    private scoped(relPath: string): string {
        const clean = stripWorkspacePrefix(relPath ?? '.').replace(/^\.\/+/, '');
        if (!this.worktreeRel) return clean || '.';
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
     * 파일 경로로 받는 컨테이너용 계약은 쓰지 않는다 — 로컬 브라우저는 runBrowserSpec 으로만 실행한다
     * (액션 파일을 사용자 폴더에 썼다 지우지 않는다). 이 경로로 들어오면 브리지 요청 없이 거절한다.
     */
    async runBrowser(_actionsRelPath: string): Promise<ExecResult> {
        return {
            stdout: '', exitCode: -1, truncated: false, timedOut: false, durationMs: 0,
            stderr: '로컬 실행기의 브라우저는 이 경로로 실행할 수 없습니다(runBrowserSpec 사용).',
        };
    }

    /** 사이트 정책으로 액션을 훑는다 — 정책은 호출마다 읽는다(관리자가 허용 목록을 바꾸면 다음 호출부터 반영). */
    async planBrowserSitePolicy(actions: readonly unknown[]): Promise<BrowserSitePlan> {
        const { browserSite } = await resolveEffectivePolicy(this.userId);
        return planBrowserActions(actions, this.lastBrowserUrl, browserSite);
    }

    async runBrowserSpec(spec: { actions: unknown[]; approvedHosts: string[] }): Promise<ExecResult> {
        const { browserSite } = await resolveEffectivePolicy(this.userId);
        const r = await this.req(
            { kind: 'browser', actions: spec.actions, sitePolicy: browserSite, approvedHosts: spec.approvedHosts, taskId: this.taskId },
            LOCAL_BRIDGE.BROWSER_TIMEOUT_MS,
        );
        // 기기가 돌려준 현재 주소를 기억한다 — 실패·차단으로 끝나도 주소는 온다.
        try {
            const out = JSON.parse(r.stdout ?? '') as { finalUrl?: unknown };
            if (typeof out.finalUrl === 'string') this.lastBrowserUrl = out.finalUrl;
        } catch { /* 결과가 JSON 이 아니다(전송 실패 등) — 주소는 그대로 둔다 */ }
        return toExecResult(r);
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
