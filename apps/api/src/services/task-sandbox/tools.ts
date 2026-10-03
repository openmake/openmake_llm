/**
 * ============================================================
 * Task Sandbox Tools — 영속 샌드박스에서 동작하는 에이전트 도구 (Phase 1 / C1)
 * ============================================================
 *
 * OpenManus ToolCollection[PythonExecute, BrowserUseTool, StrReplaceEditor,
 * AskHuman, Terminate] 대응. task별 TaskSandbox 인스턴스를 클로저로 바인딩하는
 * factory(createTaskTools) 로 제공한다 — 전역 builtInTools 가 아닌 task-scoped.
 *
 * B 흡수(루프 로버스트니스): terminate(완료 시그널) + ask_human(HITL pause).
 * terminate 는 sentinel 결과를 AgentTaskService 가 해석해 종료하고, ask_human 은
 * TaskRuntime.executeTaskTool 이 승인 레지스트리로 대기시킨다(둘 다 배선 완료).
 *
 * @module services/task-sandbox/tools
 */
import { findBlockedBrowserUrls } from './browser-url-guard';
import { BROWSER_URL_GUARD_ENABLED } from '../../config/task-sandbox';
import { getBrowserUrlBlockedMessage } from '../../prompts/agent-task-prompt';
import { viewWindow } from './file-view';
import { resolveMissedStrReplace } from './str-replace-match';
import { interpretExitCode } from './exit-code';
import { ASK_HUMAN_STRUCTURED_SCHEMA, normalizeAskHuman } from './ask-human';
import { ASK_HUMAN } from '../../config/agent-task-tools';
import { ASK_HUMAN_STRUCTURED_DESCRIPTION } from '../../prompts/agent-task-tools';
import { FILE_VIEW_MAX_CHARS } from '../../config/runtime-limits';
import { randomUUID } from 'crypto';
import { AgentTaskParked } from '../agent-task/types';
import type { MCPToolDefinition, MCPToolResult } from '../../tool-contract/types';
import type { ContributedAgentTaskTool } from '../chat-service/turn-integrations';
import type { TaskExecutor, ExecResult } from './executor';
import { withDiagnostics } from './diagnostics-attach';
import { createCodeNavTools } from './tools-code-nav';
import { TaskPlan } from './planning';
import { createPlanTools } from './tools-plan';
import {
    SPAWN_AGENTS_TOOL_NAME,
    SPAWN_AGENTS_TOOL_DESCRIPTION,
    SPAWN_AGENTS_PARAMETERS_SCHEMA,
    type SpawnFn,
} from '../agent-spawn/spawn-agents';

export type { SpawnFn } from '../agent-spawn/spawn-agents';

/** 루프가 인식하는 제어 시그널 sentinel (도구 결과 텍스트 prefix). */
export const TASK_TERMINATE_SENTINEL = '__TASK_TERMINATE__';

/** file_ops tree 상한 — 실행기(walk/listWorkspaceFilesAt)의 1000개 캡과 일치시킨다. */
const FILE_TREE_MAX = 1000;

/** 실행기가 브라우저를 지원하지 않을 때의 거절 문구 — 로컬 실행기는 항상, 샌드박스는 게이트 OFF 일 때. */
const BROWSER_UNAVAILABLE = '이 실행 환경에서는 브라우저를 쓸 수 없습니다 (로컬 실행 작업이거나 TASK_SANDBOX_BROWSER_ENABLED=false).';

export const TASK_ASK_HUMAN_SENTINEL = '__TASK_ASK_HUMAN__';

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

/**
 * 브라우저가 이동하려는 주소 중 막아야 할 것이 있으면 오류 문구, 없으면 null(browser-url-guard).
 * TASK_SANDBOX_BROWSER_URL_GUARD=false 로 끈다.
 */
async function browserUrlBlock(actions: readonly unknown[]): Promise<string | null> {
    if (!BROWSER_URL_GUARD_ENABLED) return null;
    const blocked = await findBlockedBrowserUrls(actions);
    return blocked.length > 0 ? getBrowserUrlBlockedMessage(blocked.map((b) => b.url)) : null;
}

/** exec 결과를 LLM 친화 텍스트로 포맷. command 를 주면 오류가 아닌 종료 코드(grep 1 등)에 뜻을 덧붙인다(exit-code). */
function formatExec(r: ExecResult, command?: string): MCPToolResult {
    const parts: string[] = [];
    if (r.stdout) parts.push(`[stdout]\n${r.stdout}`);
    if (r.stderr) parts.push(`[stderr]\n${r.stderr}`);
    parts.push(`[exit=${r.exitCode}${r.timedOut ? ' TIMEOUT' : ''}${r.truncated ? ' TRUNCATED' : ''} ${r.durationMs}ms]`);
    const note = command !== undefined && !r.timedOut ? interpretExitCode(command, r.exitCode) : null;
    if (note) parts.push(note);
    return textResult(parts.join('\n'), (r.exitCode !== 0 && !note) || r.timedOut);
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

/**
 * 호스트가 쓰고 곧바로 컨테이너가 읽는 임시 파일을 **호출마다 새 이름으로** 만들어 실행하고, 끝나면 지운다.
 *
 * workspace 는 호스트 디렉터리를 컨테이너에 bind mount 한 것이다. macOS 의 Colima(virtiofs)는 컨테이너가
 * 방금 본 파일을 호스트가 덮어쓰면 약 1초 동안 예전 크기로 읽는다 — 더 길어진 코드가 중간에 잘려 실행된다
 * (2026-09-29 실측: 'node-written-longer-content' 가 'no' 로 읽혔다). 컨테이너가 처음 보는 파일에는 이 문제가 없다.
 * 이름이 '.' 으로 시작해 산출물 목록에는 나오지 않는다.
 */
async function runFresh(
    sandbox: TaskExecutor,
    name: { dir?: string; prefix: string; ext: string },
    content: string,
    run: (relPath: string) => Promise<ExecResult>,
): Promise<{ result: ExecResult; relPath: string }> {
    const relPath = `${name.dir ? `${name.dir}/` : ''}${name.prefix}-${randomUUID().slice(0, 8)}${name.ext}`;
    await sandbox.writeFile(relPath, content);
    try {
        return { result: await run(relPath), relPath };
    } finally {
        await sandbox.deleteFile(relPath).catch(() => { /* best-effort — 남아도 workspace 정리 때 함께 사라진다 */ });
    }
}

/**
 * task별 도구 세트 생성. AgentTaskService 가 task 시작 시 TaskSandbox 와 함께 호출해
 * effectiveTools 에 합류시킨다.
 */
/** 전문가 자문 콜백 — subgoal 을 적합 산업 전문가(페르소나)에게 1회 위임해 응답을 받는다. */
export type DelegateFn = (subgoal: string, role?: string) => Promise<string>;

import { createProceduralTools, type ProceduralHooks } from './tools-procedural';
export type { ProceduralHooks } from './tools-procedural';

export function createTaskTools(
    sandbox: TaskExecutor,
    plan: TaskPlan = new TaskPlan(),
    delegate?: DelegateFn,
    spawn?: SpawnFn,
    procedural?: ProceduralHooks,
    browserMetrics?: (stdout: string) => void,
    /** 복수 전문가 토론(MoA) 실행 — 미주입이면 도구 자체를 노출하지 않는다. */
    /** add-on 이 기여한 작업 도구 (예: 복수 전문가 토론) — 미주입이면 미노출(도구폭주 방지) */
    contributed: readonly ContributedAgentTaskTool[] = [],
    contributedCtx: { userId: string } = { userId: 'guest' },
): MCPToolDefinition[] {
    const bash: MCPToolDefinition = {
        tool: {
            name: 'bash',
            description: '작업 디렉토리에서 셸 명령을 실행합니다. 파일은 단계 간 유지됩니다. ' +
                'git/curl/ripgrep/python3/node 사용 가능. 네트워크는 정책에 따라 제한될 수 있습니다.',
            inputSchema: {
                type: 'object',
                properties: { command: { type: 'string', description: '실행할 셸 명령' } },
                required: ['command'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const command = str(args.command).trim();
            if (!command) return textResult('command 가 필요합니다.', true);
            return formatExec(await sandbox.exec(command), command);
        },
    };

    const pythonExecute: MCPToolDefinition = {
        tool: {
            name: 'python_execute',
            description: '작업 디렉토리에 Python 코드를 파일로 저장하고 실행합니다. 결과(stdout/stderr)를 반환합니다.',
            inputSchema: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: '실행할 Python 코드' },
                    filename: { type: 'string', description: '저장 파일명 (기본 _exec.py)' },
                },
                required: ['code'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const code = str(args.code);
            if (!code) return textResult('code 가 필요합니다.', true);
            const filename = str(args.filename) || '_exec.py';
            // 셸 명령(`python3 ${filename}`)에 보간되므로 안전 문자만 허용 —
            // 메타문자(; | & $ 공백 등) 셸 주입과 `-` 선행(인자 주입: -c ...)을 차단.
            if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(filename)) {
                return textResult('filename 은 영숫자로 시작하고 영숫자·._/- 만 포함해야 합니다.', true);
            }
            try {
                // 요청한 이름으로도 남긴다(산출물·재실행용). 실행은 같은 디렉터리의 새 이름으로 — runFresh 참조.
                await sandbox.writeFile(filename, code);
                const slash = filename.lastIndexOf('/');
                const { result, relPath } = await runFresh(
                    sandbox,
                    { dir: slash > 0 ? filename.slice(0, slash) : undefined, prefix: '.run', ext: '.py' },
                    code,
                    (p) => sandbox.exec(`python3 ${p}`),
                );
                // traceback 등에 임시 이름이 나오면 모델이 없는 파일을 찾는다 — 요청한 이름으로 바꿔 보여 준다.
                return formatExec({
                    ...result,
                    stdout: result.stdout.split(relPath).join(filename),
                    stderr: result.stderr.split(relPath).join(filename),
                });
            } catch (e) {
                return textResult(`파일 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    const strReplaceEditor: MCPToolDefinition = {
        tool: {
            name: 'str_replace_editor',
            description: '작업 디렉토리의 파일을 보고/생성/편집합니다. command: view(보기) | create(생성) | ' +
                'str_replace(문자열 치환) | insert(라인 삽입).',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'view | create | str_replace | insert' },
                    path: { type: 'string', description: '작업 디렉토리 기준 상대 경로' },
                    file_text: { type: 'string', description: 'create 시 전체 내용' },
                    old_str: { type: 'string', description: 'str_replace 시 찾을 문자열(유일해야 함)' },
                    new_str: { type: 'string', description: 'str_replace/insert 시 새 문자열' },
                    insert_line: { type: 'number', description: 'insert 시 이 라인 뒤에 삽입(0=맨 앞)' },
                    start_line: { type: 'number', description: 'view 시 이 줄부터 보기(1부터). 큰 파일은 결과 첫 줄이 이어 볼 줄 번호를 알려 줍니다' },
                    line_count: { type: 'number', description: 'view 시 볼 줄 수(생략하면 들어가는 만큼)' },
                },
                required: ['command', 'path'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const command = str(args.command);
            const path = str(args.path);
            if (!path) return textResult('path 가 필요합니다.', true);
            try {
                if (command === 'create') {
                    await sandbox.writeFile(path, str(args.file_text));
                    return withDiagnostics(sandbox, path, `생성됨: ${path}`);
                }
                if (command === 'view') {
                    const content = await sandbox.readFile(path);
                    // 큰 파일은 줄 구간으로 나눠 본다 — 결과 상한을 넘는 뒷부분도 start_line 으로 볼 수 있다(file-view).
                    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
                    return textResult(viewWindow(content, path, { startLine: num(args.start_line), lineCount: num(args.line_count) }, FILE_VIEW_MAX_CHARS));
                }
                if (command === 'str_replace') {
                    const oldStr = str(args.old_str);
                    if (!oldStr) return textResult('old_str 가 필요합니다.', true);
                    const content = await sandbox.readFile(path);
                    const count = content.split(oldStr).length - 1;
                    if (count === 0) {
                        // 공백·따옴표만 다른 경우는 유일할 때 적용하고, 아니면 가장 비슷한 줄을 알린다(str-replace-match).
                        const relaxed = resolveMissedStrReplace(content, oldStr, str(args.new_str), path);
                        if (relaxed.content === undefined) return textResult(relaxed.message, true);
                        await sandbox.writeFile(path, relaxed.content);
                        return withDiagnostics(sandbox, path, relaxed.message, content);
                    }
                    if (count > 1) return textResult(`old_str 가 ${count}회 중복 — 유일해야 합니다.`, true);
                    await sandbox.writeFile(path, content.replace(oldStr, str(args.new_str)));
                    return withDiagnostics(sandbox, path, `치환 완료: ${path}`, content);
                }
                if (command === 'insert') {
                    const content = await sandbox.readFile(path);
                    const lines = content.split('\n');
                    const at = Math.max(0, Math.min(lines.length, Number(args.insert_line) || 0));
                    lines.splice(at, 0, str(args.new_str));
                    await sandbox.writeFile(path, lines.join('\n'));
                    return withDiagnostics(sandbox, path, `삽입 완료: ${path}:${at}`, content);
                }
                return textResult(`알 수 없는 command: ${command}`, true);
            } catch (e) {
                return textResult(`편집 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    const fileOps: MCPToolDefinition = {
        tool: {
            name: 'file_ops',
            description:
                '작업 디렉토리 파일 작업: op=read | write | list | tree | delete. '
                + 'list 는 해당 디렉토리만 보여주며 폴더는 이름 뒤에 "/" 가 붙는다. '
                + '하위 폴더까지 한 번에 보려면 tree 를 쓴다.',
            inputSchema: {
                type: 'object',
                properties: {
                    op: { type: 'string', description: 'read | write | list | tree | delete' },
                    path: { type: 'string', description: '작업 디렉토리 기준 상대 경로 (list 는 기본 ".", tree 는 무시)' },
                    content: { type: 'string', description: 'write 시 내용' },
                },
                required: ['op'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const op = str(args.op);
            const path = str(args.path);
            try {
                if (op === 'read') return textResult(await sandbox.readFile(path));
                if (op === 'write') { await sandbox.writeFile(path, str(args.content)); return withDiagnostics(sandbox, path, `기록됨: ${path}`); }
                if (op === 'list') return textResult((await sandbox.listDir(path || '.')).join('\n') || '(빈 디렉토리)');
                if (op === 'tree') {
                    // 하위 폴더 포함 전체 목록 — list 로 한 단계씩 파고들다 폴더를 놓치는
                    // 문제를 한 번에 해소한다. 상한(1000)에 걸리면 잘렸음을 명시한다.
                    const all = await sandbox.listWorkspaceFiles();
                    if (all.length === 0) return textResult('(빈 workspace)');
                    const capped = all.length >= FILE_TREE_MAX
                        ? `\n… 목록이 ${FILE_TREE_MAX}개에서 잘렸습니다. 하위 경로를 list 로 좁혀 확인하세요.`
                        : '';
                    return textResult(all.join('\n') + capped);
                }
                if (op === 'delete') { await sandbox.deleteFile(path); return textResult(`삭제됨: ${path}`); }
                return textResult(`알 수 없는 op: ${op}`, true);
            } catch (e) {
                return textResult(`파일 작업 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    const browser: MCPToolDefinition = {
        tool: {
            name: 'browser',
            description: '일회성 컨테이너의 chromium 으로 웹 브라우저를 자동화합니다(G2). 호출마다 빈 페이지(about:blank)에서 새로 시작하므로(쿠키·로그인만 유지) goto 와 이어지는 액션을 한 actions 배열에 함께 넣으세요. actions 배열을 순서대로 실행: ' +
                'goto{url} · click{selector} · fill{selector,text} · press{key} · wait{ms} · waitFor{selector} · ' +
                'screenshot{path?} · extractText{selector?} · extractHtml{selector?}. 결과를 JSON 으로 반환합니다. ' +
                'CSS 셀렉터(click/fill)가 실패하면 snapshot 으로 상호작용 요소를 {role,name,index} 목록으로 얻은 뒤 ' +
                'smartClick{role,name,nth?}·smartFill{role,name,text,nth?} 로 재시도하세요(CSS 변동에 견고). ' +
                '네트워크는 샌드박스 정책(none/restricted)에 따라 제한됩니다.',
            inputSchema: {
                type: 'object',
                properties: {
                    actions: {
                        type: 'array',
                        items: { type: 'object' },
                        minItems: 1,
                        description: '액션 객체 배열. 예: [{"type":"goto","url":"https://example.com"},{"type":"extractText"}]',
                    },
                    allowlist: {
                        type: 'array',
                        description: '허용 도메인 목록(예 ["example.com"]). 비허용 호스트 요청은 차단됩니다.',
                    },
                },
                required: ['actions'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!sandbox.isBrowserEnabled) {
                return textResult(BROWSER_UNAVAILABLE, true);
            }
            // 단일 액션 객체를 넘기는 실수는 배열로 감싼다(계약 유지).
            const actions = Array.isArray(args.actions)
                ? args.actions
                : (args.actions && typeof args.actions === 'object' ? [args.actions] : null);
            if (!actions || actions.length === 0) {
                return textResult(
                    Array.isArray(args.actions)
                        ? 'actions 가 빈 배열입니다 — 실제 액션 객체를 최소 1개 넣으세요. '
                            + '예: [{"type":"goto","url":"https://example.com"},{"type":"extractText"}].'
                        : 'actions 배열이 필요합니다 — 예: [{"type":"goto","url":"https://example.com"},{"type":"extractText"}].',
                    true,
                );
            }
            const urlBlock = await browserUrlBlock(actions);
            if (urlBlock) return textResult(urlBlock, true);
            const spec = {
                actions,
                ...(Array.isArray(args.allowlist) ? { allowlist: args.allowlist } : {}),
                ...(sandbox.browserStatePath ? { statePath: sandbox.browserStatePath } : {}),
            };
            let r: ExecResult;
            try {
                // 메인 샌드박스(network none)가 아닌 별도 일회성 컨테이너에서 실행.
                ({ result: r } = await runFresh(
                    sandbox, { prefix: '.browser-actions', ext: '.json' }, JSON.stringify(spec),
                    (p) => sandbox.runBrowser(p),
                ));
            } catch (e) {
                return textResult(`액션 파일 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
            browserMetrics?.(r.stdout); // Stage 0 계측(fail-open)
            return formatExec(r);
        },
    };

    // ── G3 플래닝 — tools-plan.ts(노드 속성 done_when/after, Execution Graph 증분 4) ──
    const [planCreate, planUpdate, planView] = createPlanTools(plan);

    // ── G4 멀티에이전트: 전문가 위임(자문) ──
    const delegateTool: MCPToolDefinition = {
        tool: {
            name: 'delegate',
            description: '특정 하위 문제를 적합한 산업 전문가(금융/법률/엔지니어링/의료/과학 등)에게 위임해 ' +
                '전문 자문을 받습니다. 자문 결과를 참고해 당신이 직접 다음 작업을 수행하세요. ' +
                '전문 지식·검토·판단이 필요한 단계에서 사용하세요.',
            inputSchema: {
                type: 'object',
                properties: {
                    subgoal: { type: 'string', description: '전문가에게 위임할 구체적 하위 문제/질문' },
                    role: { type: 'string', description: '원하는 전문 분야(선택, 예: finance/legal/engineering)' },
                },
                required: ['subgoal'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const subgoal = str(args.subgoal).trim();
            if (!subgoal) return textResult('subgoal 이 필요합니다.', true);
            if (!delegate) return textResult('위임 기능을 사용할 수 없습니다.', true);
            try {
                const advice = await delegate(subgoal, str(args.role) || undefined);
                return textResult(advice);
            } catch (e) {
                if (e instanceof AgentTaskParked) throw e; // 서브에이전트 승인 주차(173) — 부모가 받아 주차한다
                return textResult(`전문가 위임 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    // ── 병렬 fan-out: spawn_agents — 독립 하위 작업 N개 병렬 위임 (services/agent-spawn).
    //    AGENT_SPAWN.ENABLED 시에만 AgentTaskService 가 spawn 을 전달 → 미전달이면 도구 자체 미노출. ──
    const spawnAgentsTool: MCPToolDefinition = {
        tool: {
            name: SPAWN_AGENTS_TOOL_NAME,
            description: SPAWN_AGENTS_TOOL_DESCRIPTION,
            inputSchema: SPAWN_AGENTS_PARAMETERS_SCHEMA,
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!spawn) return textResult('병렬 위임 기능을 사용할 수 없습니다.', true);
            try {
                return textResult(await spawn(args as Record<string, unknown>));
            } catch (e) {
                return textResult(`병렬 위임 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    // ── add-on 기여 도구 — 실패해도 예외를 던지지 않고 오류 결과를 돌려준다(스텝 중단 방지) ──
    const contributedTools: MCPToolDefinition[] = contributed.map((c) => ({
        tool: c.tool,
        handler: async (args): Promise<MCPToolResult> => {
            try {
                const r = await c.run(args as Record<string, unknown>, contributedCtx);
                return textResult(r.text, r.isError === true);
            } catch (e) {
                return textResult(`${c.tool.name} 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    }));

    // ── #1 절차 스킬(skill_save / skill_run) — tools-procedural.ts ──
    const [skillSave, skillRun] = createProceduralTools(sandbox, procedural, browserMetrics, { textResult, str, formatExec, runFresh, browserUnavailable: BROWSER_UNAVAILABLE, browserUrlBlock });


    // ── B 흡수: 제어 시그널 도구 (sandbox 무관) ──
    const terminate: MCPToolDefinition = {
        tool: {
            name: 'terminate',
            description: '작업을 완료했거나 더 진행할 수 없을 때 호출해 task 를 종료합니다.',
            inputSchema: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'success | failure' },
                    summary: { type: 'string', description: '결과 요약' },
                },
                required: ['status'],
            },
        },
        handler: async (args): Promise<MCPToolResult> =>
            textResult(`${TASK_TERMINATE_SENTINEL} ${str(args.status) || 'success'}: ${str(args.summary)}`),
    };

    const askHuman: MCPToolDefinition = {
        tool: {
            name: 'ask_human',
            description: '진행에 사용자 확인이나 정보가 필요할 때 호출합니다. task 가 일시정지되고 사용자에게 알림이 가며, ' +
                '사용자는 글로 답하거나 답 없이 거절할 수 있습니다 — 한 번에 답할 수 있게 필요한 것을 구체적으로 물으세요.' +
                (ASK_HUMAN.STRUCTURED_ENABLED ? ASK_HUMAN_STRUCTURED_DESCRIPTION : ''),
            // 구조화 질문(ask-human) — 질문 여러 개·선택지·권장안. 끄면 종전처럼 question 하나만 받는다.
            inputSchema: ASK_HUMAN.STRUCTURED_ENABLED ? ASK_HUMAN_STRUCTURED_SCHEMA : {
                type: 'object',
                properties: { question: { type: 'string', description: '사용자에게 물을 질문' } },
                required: ['question'],
            },
        },
        handler: async (args): Promise<MCPToolResult> =>
            textResult(`${TASK_ASK_HUMAN_SENTINEL} ${normalizeAskHuman(args).question}`),
    };

    return [bash, pythonExecute, strReplaceEditor, fileOps, ...createCodeNavTools(sandbox), ...(sandbox.isBrowserEnabled ? [browser] : []), planCreate, planUpdate, planView, delegateTool, ...(spawn ? [spawnAgentsTool] : []), ...contributedTools, ...(procedural ? [skillSave, skillRun] : []), terminate, askHuman];
}
