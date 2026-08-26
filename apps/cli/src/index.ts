#!/usr/bin/env node
/**
 * OpenMake Code CLI — 로컬 코딩 에이전트 클라이언트.
 *
 * 서버 AgentTaskService 하네스가 턴을 오케스트레이션하고, 이 CLI 는 브리지 디바이스(도구 실행)
 * + 터미널 렌더만 담당한다(자체 에이전트 루프 없음). 명령:
 *   login                  API key·서버 URL 저장
 *   connect [dir]          폴더 상주 연결(데몬 전경 실행, 단일 폴더)
 *   status                 연결 상태·디바이스 조회
 *   "목표" [--dir .]        cwd(또는 --dir)에서 로컬 에이전트 작업 1회 실행
 *   tasks [--all]          이 디바이스의 로컬 작업 목록 (기본: 미종료·재개 가능만)
 *   show <taskId>          작업 결과·진행 기록·변경분 재출력 (조회 전용)
 *   resume <taskId> [--dir .]  checkpoint 에서 이어하기 (서버 재개 API + 같은 worktree 재부착)
 *   share <taskId>         결과를 읽기 전용 링크로 공유 (미리보기 → 확인 → 게시)
 *   "목표" --resume        마지막 재개 가능 작업이 있으면 그것을 이어한다
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadConfig, saveConfig, deviceId } from './config';
import { CliBridge, type ConfirmFn } from './bridge';
import { ApiClient, type ApiTask, type ApiTaskStep, type ShareDocument } from './api';

function prompt(q: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a.trim()); }));
}

/** 터미널 confirmExec — 대화형이면 y/a/n, 비대화형(TTY 아님)이면 자동 거부(fail-safe). */
const terminalConfirm: ConfirmFn = async (command, taskId, folderRoot) => {
    if (!process.stdin.isTTY) return 'no';
    process.stdout.write(`\n\x1b[33m⚠ 에이전트가 셸 명령을 실행하려 합니다\x1b[0m (폴더: ${folderRoot})\n  ${command.slice(0, 800)}\n`);
    const opt = taskId ? 'y=실행 / a=이 작업 동안 모두 / n=거부' : 'y=실행 / n=거부';
    const ans = (await prompt(`  ${opt}: `)).toLowerCase();
    if (ans === 'a' && taskId) return 'all';
    return ans === 'y' || ans === 'yes' ? 'yes' : 'no';
};

async function cmdLogin(): Promise<void> {
    const existing = loadConfig();
    const serverUrl = (await prompt(`서버 URL [${existing?.serverUrl ?? 'https://chat.openmake.cc'}]: `))
        || existing?.serverUrl || 'https://chat.openmake.cc';
    const apiKey = (await prompt('API key (omk_live_...): ')) || existing?.apiKey || '';
    if (!apiKey.startsWith('omk_live_')) {
        console.error('\x1b[31mAPI key 형식이 올바르지 않습니다 (omk_live_ 로 시작). 설정에서 발급하세요.\x1b[0m');
        process.exit(1);
    }
    saveConfig({ serverUrl: serverUrl.replace(/\/+$/, ''), apiKey });
    console.log(`\x1b[32m✓ 저장됨\x1b[0m (~/.openmake/config.json, device=${deviceId().slice(0, 8)}…)`);
}

function requireConfig(): { serverUrl: string; apiKey: string } {
    const cfg = loadConfig();
    if (!cfg) { console.error('먼저 `openmake-code login` 을 실행하세요.'); process.exit(1); }
    return cfg;
}

async function cmdStatus(): Promise<void> {
    const cfg = requireConfig();
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
    try {
        const s = await api.bridgeStatus();
        console.log(`서버: ${cfg.serverUrl}`);
        console.log(`로컬 실행 기능: ${s.enabled ? '활성' : '비활성(LOCAL_EXECUTOR_ENABLED=false)'}`);
        console.log(`이 디바이스 id: ${deviceId()}`);
        const devices = s.devices ?? [];
        if (devices.length === 0) { console.log('접속 디바이스: 없음 — `openmake-code connect` 로 연결하세요.'); return; }
        console.log('접속 디바이스:');
        for (const d of devices) console.log(`  - ${d.label} (${d.deviceId.slice(0, 8)}…) → ${d.folderName}`);
    } catch (e) {
        console.error(`상태 조회 실패: ${(e as Error).message}`);
        process.exit(1);
    }
}

function connectBridge(cfg: { serverUrl: string; apiKey: string }, folder: string): CliBridge {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        console.error(`폴더가 존재하지 않습니다: ${folder}`); process.exit(1);
    }
    const bridge = new CliBridge({
        serverUrl: cfg.serverUrl, apiKey: cfg.apiKey, folder,
        confirm: terminalConfirm,
        onStatus: (s) => console.log(`\x1b[36m[bridge]\x1b[0m ${s}`),
    });
    bridge.connect();
    return bridge;
}

async function cmdConnect(dirs: string[]): Promise<void> {
    const cfg = requireConfig();
    // 서버는 디바이스당 단일 폴더만 지원한다(다중 폴더는 후속). 여러 인자를 조용히
    // 버리지 않고 명시적으로 거절 — 여러 폴더가 필요하면 디바이스를 여러 개 띄운다.
    if (dirs.length > 1) {
        console.error('폴더는 하나만 지정할 수 있습니다 — 여러 폴더는 별도 터미널에서 각각 connect 하세요.');
        process.exit(1);
    }
    const folder = path.resolve(dirs[0] ?? process.cwd());
    connectBridge(cfg, folder);
    console.log(`연결 폴더: ${folder}\n종료: Ctrl+C`);
    process.on('SIGINT', () => { console.log('\n연결을 종료합니다.'); process.exit(0); });
    await new Promise(() => { /* 상주 */ });
}

function taskOf(r: { task?: ApiTask } | ApiTask): ApiTask {
    return (r as { task?: ApiTask }).task ?? (r as ApiTask);
}

/** 서버 승인 자동화 여부 — --yes 또는 비대화형(비-TTY). 셸 확인은 별개(디바이스 confirmExec). */
function shouldAutoApprove(autoApprove: boolean): boolean {
    // --yes 또는 비대화형(비-TTY)이면 서버 승인을 작업 단위로 자동화한다 — 그렇지 않으면
    // 파일 쓰기류 서버 HITL 이 매번 y/N 을 요구해 헤드리스/CI 실행이 막힌다. 셸/파이썬은
    // 별도로 디바이스 confirmExec 이 게이트하므로(OMK_BRIDGE_AUTO_APPROVE), 이 플래그는 서버측만.
    return autoApprove || !process.stdin.isTTY;
}

/** 폴더를 브리지로 연결하고 서버가 이 디바이스를 인지할 때까지 대기(최대 ~10s). 실패 시 종료. */
async function connectAndRegister(cfg: { serverUrl: string; apiKey: string }, api: ApiClient, folder: string): Promise<CliBridge> {
    const bridge = connectBridge(cfg, folder);
    const myId = deviceId();
    let registered = false;
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
            const s = await api.bridgeStatus();
            if (!s.enabled) { console.error('서버에서 로컬 실행 기능이 비활성화되어 있습니다.'); bridge.disconnect(); process.exit(1); }
            if ((s.devices ?? []).some((d) => d.deviceId === myId)) { registered = true; break; }
        } catch { /* 재시도 */ }
    }
    if (!registered) { console.error('브리지 연결에 실패했습니다.'); bridge.disconnect(); process.exit(1); }
    return bridge;
}

async function cmdRun(goal: string, dir: string, autoApprove: boolean): Promise<void> {
    const cfg = requireConfig();
    const folder = path.resolve(dir);
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
    const serverAutoApprove = shouldAutoApprove(autoApprove);
    const bridge = await connectAndRegister(cfg, api, folder);

    console.log(`\x1b[32m✓ 연결됨\x1b[0m — 작업을 생성합니다.`);
    const created = taskOf(await api.createTask(goal, deviceId()));
    const taskId = created.id;
    if (serverAutoApprove) {
        await api.setAutoApprove(taskId, true);
        console.log('\x1b[2m서버 승인 자동화 활성(--yes/비대화형) — 파일 쓰기류 HITL 자동 승인\x1b[0m');
    }
    await api.executeTask(taskId);
    console.log(`\x1b[36m작업 ${taskId} 실행 중…\x1b[0m (Ctrl+C 로 CLI 종료)`);
    await followTask(api, bridge, taskId);
}

/**
 * 진행 폴링 — run/resume 공용. 승인 대기(pending)는 터미널에서 즉시 처리, 상태는 변할 때만 출력.
 * 종료 상태에 도달하면 브리지를 끊고 프로세스를 종료한다(completed=0, 그 외 1).
 */
async function followTask(api: ApiClient, bridge: CliBridge, taskId: string): Promise<never> {
    let lastStatus = '';
    let lastProgress = -1;
    const seenApprovals = new Set<string>();
    // 안전 상한 — 서버 작업이 종료 상태로 수렴하지 않고(스톨·거부 반복 등) 무기한 폴링하는 것을
    // 막는다. 도달 시 CLI 만 종료하며 서버 작업은 계속된다(웹/재실행으로 확인 가능).
    const POLL_DEADLINE_MS = 60 * 60 * 1000;
    const startedAt = Date.now();
    for (;;) {
        if (Date.now() - startedAt > POLL_DEADLINE_MS) {
            console.error('\n\x1b[33m폴링 상한(1시간) 도달 — CLI 를 종료합니다. 작업은 서버에서 계속되며 웹에서 확인할 수 있습니다.\x1b[0m');
            bridge.disconnect();
            process.exit(1);
        }
        await new Promise((r) => setTimeout(r, 2000));
        // 이 작업의 승인 대기 처리 (confirmExec 은 브리지가 별도로 처리 — 여기선 서버 HITL 게이트).
        try {
            const { pending } = await api.listPending();
            for (const p of pending.filter((p) => p.taskId === taskId && !seenApprovals.has(p.approvalId))) {
                seenApprovals.add(p.approvalId);
                const desc = p.question || `${p.toolName}${p.kind ? ` (${p.kind})` : ''}`;
                const ans = process.stdin.isTTY ? (await prompt(`\n\x1b[33m승인 필요\x1b[0m: ${desc}\n  y=승인 / n=거부: `)).toLowerCase() : 'n';
                await api.answerApproval(p.approvalId, ans === 'y' || ans === 'yes' ? 'approve' : 'reject');
            }
        } catch { /* 폴링 실패 무시 */ }

        let task: ApiTask;
        try { task = taskOf(await api.getTask(taskId)); } catch { continue; }
        if (task.status !== lastStatus || (task.progress ?? 0) !== lastProgress) {
            lastStatus = task.status;
            lastProgress = task.progress ?? 0;
            console.log(`  [${task.status}] ${Math.round((task.progress ?? 0))}%`);
        }
        if (['completed', 'failed', 'cancelled'].includes(task.status)) {
            console.log(`\n\x1b[1m결과 (${task.status})\x1b[0m`);
            if (task.result) console.log(task.result);
            if (task.error) console.error(`\x1b[31m${task.error}\x1b[0m`);
            bridge.disconnect();
            process.exit(task.status === 'completed' ? 0 : 1);
        }
    }
}

function shortId(id: string): string { return id.length > 12 ? `${id.slice(0, 8)}…` : id; }
function fmtWhen(iso?: string): string {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '-' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** 목록 기본값: 종료(completed) 는 --all 일 때만. failed/cancelled 는 재개 후보라 항상 보여준다. */
function isListedByDefault(t: ApiTask): boolean { return t.status !== 'completed'; }

async function cmdTasks(all: boolean): Promise<void> {
    const cfg = requireConfig();
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
    const { tasks } = await api.listTasks({ deviceId: deviceId() });
    const rows = all ? tasks : tasks.filter(isListedByDefault);
    if (rows.length === 0) {
        console.log(all ? '이 디바이스의 로컬 작업이 없습니다.' : '미종료·재개 가능한 로컬 작업이 없습니다. (`--all` 로 종료 작업 포함)');
        return;
    }
    console.log(`이 디바이스(${deviceId().slice(0, 8)}…)의 로컬 작업 ${rows.length}건${all ? '' : ' — 종료 작업은 --all'}:`);
    for (const t of rows) {
        const flag = t.resumable ? ' \x1b[32m[resume 가능]\x1b[0m' : (t.status === 'running' || t.status === 'paused' || t.status === 'queued') ? ' \x1b[36m[진행 중]\x1b[0m' : '';
        const folder = t.folder_rel ? ` · 폴더 ${t.folder_rel}` : '';
        console.log(`  ${shortId(t.id).padEnd(10)} ${t.status.padEnd(9)} ${String(Math.round(t.progress ?? 0)).padStart(3)}%  ${fmtWhen(t.created_at)}  omk-task/${t.id.slice(0, 8)}${folder}${flag}`);
        if (t.goal) console.log(`             ${t.goal.replace(/\s+/g, ' ').slice(0, 60)}`);
    }
}

/** 재개 대상 선택 — 이 디바이스의 최근 `resumable`(failed+checkpoint) 작업. 진행 중이면 재개 대신 follow 대상. */
async function pickResumeTarget(api: ApiClient): Promise<{ task: ApiTask; followOnly: boolean } | null> {
    const { tasks } = await api.listTasks({ deviceId: deviceId() });
    const live = tasks.find((t) => t.status === 'running' || t.status === 'paused' || t.status === 'queued');
    if (live) return { task: live, followOnly: true };
    const cand = tasks.find((t) => t.resumable);
    return cand ? { task: cand, followOnly: false } : null;
}

/** 스텝 요약 한 줄 — 도구 결과·진단·판정을 사람이 읽는 형태로 압축. */
function stepLine(s: ApiTaskStep): string | null {
    const c = (s.content ?? '').replace(/\s+/g, ' ').trim();
    switch (s.step_type) {
        case 'tool_result': return c ? `  ${s.tool_name ?? 'tool'}: ${c.slice(0, 100)}` : null;
        case 'judge': return `  \x1b[35m판정\x1b[0m: ${c.slice(0, 140)}`;
        case 'retry': return `  \x1b[33m재시도\x1b[0m: ${c.slice(0, 100)}`;
        case 'hitl_degrade': return `  \x1b[33m승인 무응답 강등\x1b[0m`;
        case 'steering': return `  \x1b[36m지시 추가\x1b[0m: ${c.slice(0, 100)}`;
        case 'artifact': return `  \x1b[32m아티팩트\x1b[0m: ${c.slice(0, 100)}`;
        default: return null; // assistant_tool_call/plan/assistant/diff 는 별도 집계·출력
    }
}

/**
 * 완료·실패한 작업의 결과를 다시 본다. 실행 없이 조회만 하므로 디바이스 연결이 필요 없다
 * (resume 과 달리 폴더도 필요 없다 — 서버에 남은 기록만 읽는다).
 */
async function cmdShow(taskId: string, opts: { steps: boolean; diff: boolean }): Promise<void> {
    const cfg = requireConfig();
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
    const task = taskOf(await api.getTask(taskId));
    const { steps } = await api.listSteps(taskId).catch(() => ({ steps: [] as ApiTaskStep[] }));

    const tone = task.status === 'completed' ? '\x1b[32m' : task.status === 'running' ? '\x1b[36m' : '\x1b[31m';
    console.log(`\x1b[1m${shortId(task.id)}\x1b[0m  ${tone}${task.status}\x1b[0m ${Math.round(task.progress ?? 0)}%  ${fmtWhen(task.created_at)}`);
    if (task.goal) {
        const g = task.goal.replace(/\s+/g, ' ');
        console.log(`목표: ${g.length > 200 ? `${g.slice(0, 200)}… (${g.length}자)` : g}`);
    }
    if (task.folder_rel) console.log(`폴더: ${task.folder_rel}`);
    if (task.executor === 'local') console.log(`브랜치: omk-task/${task.id.slice(0, 8)}`);

    // 진행 요약 — 도구 호출 수·턴·재시도는 한 줄로.
    const calls = steps.filter((s) => s.step_type === 'assistant_tool_call').length;
    const retries = steps.filter((s) => s.step_type === 'retry').length;
    const diffs = steps.filter((s) => s.step_type === 'diff');
    console.log(`\x1b[2m스텝 ${steps.length}개 · 도구 호출 ${calls}회${retries ? ` · 재시도 ${retries}회` : ''}${diffs.length ? ` · diff ${diffs.length}건` : ''}\x1b[0m`);

    if (task.result) console.log(`\n\x1b[1m결과\x1b[0m\n${task.result}`);
    // completed 인데 error 가 남은 행은 2026-08-26 이전 데이터다(PR #638 이 완료 시 error 를
    // 지우기 전). 성공을 실패처럼 보이지 않게 흐리게 "이전 시도"로 표기한다.
    if (task.error) {
        console.log(task.status === 'completed'
            ? `\n\x1b[2m(이전 시도 사유: ${task.error})\x1b[0m`
            : `\n\x1b[31m오류: ${task.error}\x1b[0m`);
    }

    if (opts.steps) {
        console.log('\n\x1b[1m진행 기록\x1b[0m');
        const lines = steps.map(stepLine).filter((l): l is string => l !== null);
        console.log(lines.length ? lines.join('\n') : '  (표시할 기록 없음)');
    }
    if (opts.diff) {
        console.log('\n\x1b[1m변경분\x1b[0m');
        console.log(diffs.length ? diffs.map((d) => d.content ?? '').join('\n') : '  (변경분 없음 — worktree 격리가 없었거나 변경이 없었다)');
    }
    if (!opts.steps && !opts.diff && (steps.length > 0 || diffs.length > 0)) {
        console.log(`\n\x1b[2m--steps 로 진행 기록, --diff 로 변경분을 볼 수 있습니다.\x1b[0m`);
    }
}

/** 공유 문서를 사람이 읽을 형태로 — "무엇이 공개되는지"를 게시 전에 그대로 보여준다. */
function printSharePreview(doc: ShareDocument): void {
    console.log('\x1b[1m─ 공개될 내용 ─────────────────────────\x1b[0m');
    console.log(`상태: ${doc.status} · 턴 ${doc.summary.turns} · 도구 호출 ${doc.summary.toolCalls}회`
        + `${doc.summary.retries ? ` · 재시도 ${doc.summary.retries}회` : ''}`
        + `${doc.summary.diffs ? ` · diff ${doc.summary.diffs}건` : ''}`);
    if (doc.goal) console.log(`\n\x1b[1m목표\x1b[0m\n${doc.goal}`);
    if (doc.result) console.log(`\n\x1b[1m결과\x1b[0m\n${doc.result}`);
    if (doc.steps.length) {
        console.log(`\n\x1b[1m진행 기록\x1b[0m (${doc.steps.length}건)`);
        for (const st of doc.steps.slice(0, 20)) console.log(`  \x1b[2m${st.n}\x1b[0m ${st.tool ?? st.type}: ${st.text}`);
        if (doc.steps.length > 20) console.log(`  \x1b[2m… 외 ${doc.steps.length - 20}건\x1b[0m`);
    }
    if (doc.artifacts.length) {
        console.log(`\n\x1b[1m산출물\x1b[0m (${doc.artifacts.length}건)`);
        for (const a of doc.artifacts) {
            console.log(`  ${a.title} \x1b[2m(${a.kind}${a.body ? `, 본문 ${a.body.length}자` : ', 본문 제외'})\x1b[0m`);
        }
    }
    if (doc.diffs.length) console.log(`\n\x1b[1m변경분\x1b[0m ${doc.diffs.length}건 (${doc.diffs.reduce((n, d) => n + d.length, 0)}자)`);
    console.log('\x1b[1m──────────────────────────────────────\x1b[0m');
    console.log('\x1b[2m경로·자격증명은 자동 정화되지만 완전하지 않습니다 — 위 내용을 직접 확인하세요.\x1b[0m');
}

/**
 * 공유 — 게시는 되돌릴 수 있지만(해제) **이미 본 사람은 되돌릴 수 없다**. 그래서 항상
 * 미리보기를 먼저 출력하고, TTY 면 y/N 확인, 비대화형이면 `--yes` 를 요구한다.
 */
async function cmdShare(taskId: string, opts: {
    link: boolean; steps: boolean; diff: boolean; artifacts: boolean; off: boolean;
    previewOnly: boolean; republish: boolean; openArtifacts: boolean; yes: boolean;
}): Promise<void> {
    const cfg = requireConfig();
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);

    if (opts.off) {
        const r = await api.unshare(taskId);
        console.log(r.unshared ? '\x1b[32m✓ 공유를 해제했습니다 — 링크는 더 이상 열리지 않습니다.\x1b[0m' : '공유 중이 아닙니다.');
        return;
    }

    const { share } = await api.getShare(taskId).catch(() => ({ share: null }));

    if (opts.openArtifacts) {
        if (!share) { console.error('공유 중이 아닙니다 — 먼저 `openmake-code share <taskId>` 로 게시하세요.'); process.exit(1); }
        const { document } = await api.getSharedTask(share.shareId, share.shareToken);
        if (!document.artifacts.length) { console.log('산출물이 없습니다.'); return; }
        console.log(`\x1b[1m산출물 열람 URL\x1b[0m \x1b[2m(발급 토큰은 유효기간이 있습니다)\x1b[0m`);
        for (const [i, a] of document.artifacts.entries()) {
            if (!a.viewerId) {
                // 뷰어가 없는 경우(뷰어 기능 off·본문 없음) — 본문이 문서에 있으면 그걸로 대신한다.
                console.log(`  ${i}. ${a.title} \x1b[2m(${a.kind} — 뷰어 없음${a.body ? `, 본문 ${a.body.length}자는 공유 페이지에서` : ''})\x1b[0m`);
                continue;
            }
            try {
                const { url } = await api.openSharedArtifact(share.shareId, i, share.shareToken);
                console.log(`  ${i}. ${a.title} \x1b[2m(${a.kind})\x1b[0m\n     ${url}`);
            } catch (e) {
                console.log(`  ${i}. ${a.title} \x1b[31m— URL 발급 실패: ${(e as Error).message}\x1b[0m`);
            }
        }
        return;
    }
    if (share && !opts.previewOnly && !opts.republish) {
        // 이미 공유 중 — 링크만 다시 보여준다(재게시는 내용 변경이므로 명시적으로).
        console.log(`\x1b[32m이미 공유 중\x1b[0m (${share.visibility}${share.includeDiff ? ', diff 포함' : ''})`);
        console.log(`  ${cfg.serverUrl}${share.path}`);
        console.log('\x1b[2m산출물 열람: `--open` · 최신 내용으로 다시 게시: `--republish` · 해제: `--off`\x1b[0m');
        return;
    }

    const toggles = { includeSteps: opts.steps, includeDiff: opts.diff, includeArtifacts: opts.artifacts };
    const { preview } = await api.previewShare(taskId, toggles);
    printSharePreview(preview);
    if (opts.previewOnly) { console.log('\x1b[2m(미리보기만 — 게시되지 않았습니다)\x1b[0m'); return; }

    if (opts.republish && share) console.log('\x1b[2m재게시 — 기존 링크는 그대로 유지되고 내용만 갱신됩니다.\x1b[0m');
    const visibility = opts.link ? 'link' : (opts.republish && share ? share.visibility : 'authenticated');
    // 안내 문구는 **결정된 visibility** 에서 뽑는다 — 플래그(opts.link)로 뽑으면 재게시 때
    // 실제로는 공개 링크를 내면서 "로그인 사용자에게만" 이라고 말하게 된다(확인 질문 포함).
    const scope = visibility === 'link' ? '링크를 아는 누구나(로그인 불필요)' : '이 서버에 로그인한 사용자';
    if (!opts.yes) {
        if (!process.stdin.isTTY) {
            console.error(`\n비대화형에서는 --yes 가 필요합니다 (공개 범위: ${scope}).`);
            process.exit(1);
        }
        const ans = (await prompt(`\n위 내용을 ${scope}에게 공개합니다. 게시할까요? (y/N): `)).toLowerCase();
        if (ans !== 'y' && ans !== 'yes') { console.log('취소했습니다.'); return; }
    }

    const r = await api.publishShare(taskId, { visibility, ...toggles });
    console.log(`\x1b[32m✓ 공유됨\x1b[0m (${scope})`);
    console.log(`  ${cfg.serverUrl}${r.path}`);
    if (preview.artifacts.length) console.log(`\x1b[2m산출물 ${preview.artifacts.length}건 열람 URL: openmake-code share ${taskId} --open\x1b[0m`);
    console.log('\x1b[2m해제: openmake-code share ' + taskId + ' --off\x1b[0m');
}

async function cmdResume(taskId: string, dir: string, autoApprove: boolean): Promise<void> {
    const cfg = requireConfig();
    const folder = path.resolve(dir);
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
    // 서버는 folder_rel(상대경로)만 안다 — 루트는 --dir/cwd 로 사용자가 준 것만 쓴다(디바이스 발원 원칙).
    const task = taskOf(await api.getTask(taskId));
    if (task.executor !== 'local') { console.error('로컬 실행 작업이 아닙니다 — 웹에서 이어하세요.'); process.exit(1); }
    if (task.device_id && task.device_id !== deviceId()) {
        console.error(`이 작업은 다른 디바이스(${task.device_id.slice(0, 8)}…)에서 만든 것입니다. 그 디바이스에서 resume 하세요.`);
        process.exit(1);
    }
    const bridge = await connectAndRegister(cfg, api, folder);
    if (task.status === 'running' || task.status === 'paused' || task.status === 'queued') {
        console.log(`\x1b[36m작업 ${taskId} 는 진행 중 — 재개 대신 진행을 따라갑니다.\x1b[0m`);
        await followTask(api, bridge, taskId);
    }
    if (shouldAutoApprove(autoApprove)) {
        await api.setAutoApprove(taskId, true);
        console.log('\x1b[2m서버 승인 자동화 활성(--yes/비대화형)\x1b[0m');
    }
    try {
        const r = await api.resumeTask(taskId);
        console.log(`\x1b[32m✓ ${r.message ?? '작업을 이어서 시작했습니다.'}\x1b[0m (${taskId}${task.folder_rel ? `, 폴더 ${task.folder_rel}` : ''})`);
    } catch (e) {
        // 서버 400 사유(디바이스 미연결·checkpoint 없음·이미 완료 등)를 그대로 보여준다
        console.error(`\x1b[31m재개 실패: ${(e as Error).message}\x1b[0m`);
        bridge.disconnect();
        process.exit(1);
    }
    await followTask(api, bridge, taskId);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    if (cmd === 'login') return cmdLogin();
    if (cmd === 'status') return cmdStatus();
    if (cmd === 'connect') return cmdConnect(argv.slice(1));
    if (cmd === 'tasks') return cmdTasks(argv.includes('--all'));
    if (cmd === 'show') {
        const taskId = argv[1];
        if (!taskId || taskId.startsWith('--')) { console.error('사용법: openmake-code show <taskId> [--steps] [--diff]'); process.exit(1); }
        return cmdShow(taskId, { steps: argv.includes('--steps'), diff: argv.includes('--diff') });
    }
    if (cmd === 'share') {
        const taskId = argv[1];
        if (!taskId || taskId.startsWith('--')) {
            console.error('사용법: openmake-code share <taskId> [--link] [--no-steps] [--no-diff] [--no-artifacts] [--preview] [--republish] [--open] [--off] [--yes]');
            process.exit(1);
        }
        return cmdShare(taskId, {
            link: argv.includes('--link'),
            steps: !argv.includes('--no-steps'),
            diff: !argv.includes('--no-diff'),
            artifacts: !argv.includes('--no-artifacts'),
            off: argv.includes('--off'),
            previewOnly: argv.includes('--preview'),
            openArtifacts: argv.includes('--open'),
            republish: argv.includes('--republish'),
            yes: argv.includes('--yes') || argv.includes('-y'),
        });
    }
    if (cmd === 'resume') {
        const taskId = argv[1];
        if (!taskId || taskId.startsWith('--')) { console.error('사용법: openmake-code resume <taskId> [--dir .] [--yes]'); process.exit(1); }
        const di = argv.indexOf('--dir');
        return cmdResume(taskId, di >= 0 ? argv[di + 1] ?? '.' : '.', argv.includes('--yes') || argv.includes('-y'));
    }
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
        console.log(`OpenMake Code — 로컬 코딩 에이전트 CLI

사용법:
  openmake-code login              API key·서버 URL 저장
  openmake-code connect [dir]      폴더 상주 연결 (웹에서 작업을 시작할 수 있게 됨)
  openmake-code status             연결 상태·디바이스 조회
  openmake-code "목표" [--dir .] [--yes]   로컬 에이전트 작업 1회 실행
                                   (--yes: 파일 쓰기류 서버 승인 자동화. 셸은 별도 확인)
  openmake-code tasks [--all]      이 디바이스의 로컬 작업 목록 (종료 작업은 --all)
  openmake-code show <taskId> [--steps] [--diff]   작업 결과 다시 보기 (실행 없음·연결 불필요)
  openmake-code resume <taskId> [--dir .] [--yes]   checkpoint 에서 이어하기 (같은 worktree 재부착)
  openmake-code share <taskId> [--link] [--preview] [--off]   결과를 읽기 전용 링크로 공유
                                   (미리보기 출력 → 확인 후 게시. 기본 공개 범위는 로그인 사용자,
                                    --link 는 링크를 아는 누구나. --no-steps/--no-diff/--no-artifacts 로 범위 축소,
                                    --open 은 공유된 산출물의 열람 URL 발급)
  openmake-code "목표" --resume    재개 가능한 최근 작업이 있으면 그것을 이어감 (없으면 새 작업)`);
        return;
    }
    // 나머지는 목표 실행 — "목표" [--dir path]
    const dirIdx = argv.indexOf('--dir');
    const dir = dirIdx >= 0 ? argv[dirIdx + 1] ?? '.' : '.';
    const autoApprove = argv.includes('--yes') || argv.includes('-y');
    const wantResume = argv.includes('--resume');
    const goal = argv
        .filter((a, i) => a !== '--dir' && i !== dirIdx + 1 && a !== '--yes' && a !== '-y' && a !== '--resume')
        .join(' ').trim();
    if (wantResume) {
        const cfg = requireConfig();
        const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
        const target = await pickResumeTarget(api);
        if (target) {
            console.log(`\x1b[2m--resume: ${target.followOnly ? '진행 중인' : '재개 가능한'} 작업 ${shortId(target.task.id)} 을 ${target.followOnly ? '따라갑니다' : '이어합니다'}${goal ? ' (입력한 목표는 무시)' : ''}\x1b[0m`);
            return cmdResume(target.task.id, dir, autoApprove);
        }
        if (!goal) { console.error('재개 가능한 작업이 없고 새 목표도 없습니다.'); process.exit(1); }
        console.log('\x1b[2m--resume: 재개 가능한 작업이 없어 새 작업을 만듭니다.\x1b[0m');
    }
    if (!goal) { console.error('목표를 입력하세요. `openmake-code help` 참고.'); process.exit(1); }
    return cmdRun(goal, dir, autoApprove);
}

main().catch((e) => { console.error(`\x1b[31m오류: ${(e as Error).message}\x1b[0m`); process.exit(1); });
