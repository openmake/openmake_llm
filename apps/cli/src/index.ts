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
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadConfig, saveConfig, deviceId } from './config';
import { CliBridge, type ConfirmFn } from './bridge';
import { ApiClient, type ApiTask } from './api';

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

async function cmdRun(goal: string, dir: string, autoApprove: boolean): Promise<void> {
    const cfg = requireConfig();
    const folder = path.resolve(dir);
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);
    // --yes 또는 비대화형(비-TTY)이면 서버 승인을 작업 단위로 자동화한다 — 그렇지 않으면
    // 파일 쓰기류 서버 HITL 이 매번 y/N 을 요구해 헤드리스/CI 실행이 막힌다. 셸/파이썬은
    // 별도로 디바이스 confirmExec 이 게이트하므로(OMK_BRIDGE_AUTO_APPROVE), 이 플래그는 서버측만.
    const serverAutoApprove = autoApprove || !process.stdin.isTTY;
    const bridge = connectBridge(cfg, folder);

    // 브리지 등록 대기 (서버가 이 디바이스를 인지할 때까지 최대 ~10s).
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

    console.log(`\x1b[32m✓ 연결됨\x1b[0m — 작업을 생성합니다.`);
    const created = taskOf(await api.createTask(goal, myId));
    const taskId = created.id;
    if (serverAutoApprove) {
        await api.setAutoApprove(taskId, true);
        console.log('\x1b[2m서버 승인 자동화 활성(--yes/비대화형) — 파일 쓰기류 HITL 자동 승인\x1b[0m');
    }
    await api.executeTask(taskId);
    console.log(`\x1b[36m작업 ${taskId} 실행 중…\x1b[0m (Ctrl+C 로 CLI 종료)`);

    // 진행 폴링 — 승인 대기(pending)는 터미널에서 즉시 처리, 상태는 변할 때만 출력.
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

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    if (cmd === 'login') return cmdLogin();
    if (cmd === 'status') return cmdStatus();
    if (cmd === 'connect') return cmdConnect(argv.slice(1));
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
        console.log(`OpenMake Code — 로컬 코딩 에이전트 CLI

사용법:
  openmake-code login              API key·서버 URL 저장
  openmake-code connect [dir]      폴더 상주 연결 (웹에서 작업을 시작할 수 있게 됨)
  openmake-code status             연결 상태·디바이스 조회
  openmake-code "목표" [--dir .] [--yes]   로컬 에이전트 작업 1회 실행
                                   (--yes: 파일 쓰기류 서버 승인 자동화. 셸은 별도 확인)`);
        return;
    }
    // 나머지는 목표 실행 — "목표" [--dir path]
    const dirIdx = argv.indexOf('--dir');
    const dir = dirIdx >= 0 ? argv[dirIdx + 1] ?? '.' : '.';
    const autoApprove = argv.includes('--yes') || argv.includes('-y');
    const goal = argv
        .filter((a, i) => a !== '--dir' && i !== dirIdx + 1 && a !== '--yes' && a !== '-y')
        .join(' ').trim();
    if (!goal) { console.error('목표를 입력하세요. `openmake-code help` 참고.'); process.exit(1); }
    return cmdRun(goal, dir, autoApprove);
}

main().catch((e) => { console.error(`\x1b[31m오류: ${(e as Error).message}\x1b[0m`); process.exit(1); });
