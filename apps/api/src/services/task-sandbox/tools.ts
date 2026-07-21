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
import type { MCPToolDefinition, MCPToolResult } from '../../mcp/types';
import type { TaskSandbox, ExecResult } from './sandbox';
import { TaskPlan, type PlanStepStatus } from './planning';
import {
    SPAWN_AGENTS_TOOL_NAME,
    SPAWN_AGENTS_TOOL_DESCRIPTION,
    SPAWN_AGENTS_PARAMETERS_SCHEMA,
    type SpawnFn,
} from '../agent-spawn/spawn-agents';

export type { SpawnFn } from '../agent-spawn/spawn-agents';

/** 루프가 인식하는 제어 시그널 sentinel (도구 결과 텍스트 prefix). */
export const TASK_TERMINATE_SENTINEL = '__TASK_TERMINATE__';
export const TASK_ASK_HUMAN_SENTINEL = '__TASK_ASK_HUMAN__';

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

/** exec 결과를 LLM 친화 텍스트로 포맷. */
function formatExec(r: ExecResult): MCPToolResult {
    const parts: string[] = [];
    if (r.stdout) parts.push(`[stdout]\n${r.stdout}`);
    if (r.stderr) parts.push(`[stderr]\n${r.stderr}`);
    parts.push(`[exit=${r.exitCode}${r.timedOut ? ' TIMEOUT' : ''}${r.truncated ? ' TRUNCATED' : ''} ${r.durationMs}ms]`);
    return textResult(parts.join('\n'), r.exitCode !== 0 || r.timedOut);
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

/**
 * task별 도구 세트 생성. AgentTaskService 가 task 시작 시 TaskSandbox 와 함께 호출해
 * effectiveTools 에 합류시킨다.
 */
/** 전문가 자문 콜백 — subgoal 을 적합 산업 전문가(페르소나)에게 1회 위임해 응답을 받는다. */
export type DelegateFn = (subgoal: string, role?: string) => Promise<string>;

/** 절차 스킬(save/load) 훅 — userId·repo 를 아는 TaskRuntime 이 바인딩한다.
 *  재생(실행)은 sandbox 를 가진 tools.ts 가 수행하므로 여기선 저장/조회만 노출한다. */
export interface ProceduralHooks {
    /** 성공한 절차를 저장 → skill id. */
    save: (input: {
        name: string;
        description: string;
        kind: 'browser' | 'script';
        actions?: unknown[];
        allowlist?: string[];
        lang?: 'bash' | 'python';
        code?: string;
        params?: string[];
    }) => Promise<string>;
    /** id 로 저장된 절차 스펙 조회(소유자 격리는 훅 내부에서 적용). */
    load: (skillId: string) => Promise<{
        kind: 'browser' | 'script';
        actions?: unknown[];
        allowlist?: string[];
        lang?: 'bash' | 'python';
        code?: string;
    } | null>;
}

export function createTaskTools(
    sandbox: TaskSandbox,
    plan: TaskPlan = new TaskPlan(),
    delegate?: DelegateFn,
    spawn?: SpawnFn,
    procedural?: ProceduralHooks,
): MCPToolDefinition[] {
    const bash: MCPToolDefinition = {
        tool: {
            name: 'bash',
            description: '영속 작업 컨테이너(/workspace)에서 셸 명령을 실행합니다. 파일은 단계 간 유지됩니다. ' +
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
            return formatExec(await sandbox.exec(command));
        },
    };

    const pythonExecute: MCPToolDefinition = {
        tool: {
            name: 'python_execute',
            description: '/workspace 에 Python 코드를 파일로 저장하고 실행합니다. 결과(stdout/stderr)를 반환합니다.',
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
                await sandbox.writeFile(filename, code);
            } catch (e) {
                return textResult(`파일 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
            return formatExec(await sandbox.exec(`python3 ${filename}`));
        },
    };

    const strReplaceEditor: MCPToolDefinition = {
        tool: {
            name: 'str_replace_editor',
            description: '/workspace 파일을 보고/생성/편집합니다. command: view(보기) | create(생성) | ' +
                'str_replace(문자열 치환) | insert(라인 삽입).',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'view | create | str_replace | insert' },
                    path: { type: 'string', description: 'workspace 상대 경로' },
                    file_text: { type: 'string', description: 'create 시 전체 내용' },
                    old_str: { type: 'string', description: 'str_replace 시 찾을 문자열(유일해야 함)' },
                    new_str: { type: 'string', description: 'str_replace/insert 시 새 문자열' },
                    insert_line: { type: 'number', description: 'insert 시 이 라인 뒤에 삽입(0=맨 앞)' },
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
                    return textResult(`생성됨: ${path}`);
                }
                if (command === 'view') {
                    const content = await sandbox.readFile(path);
                    return textResult(content);
                }
                if (command === 'str_replace') {
                    const oldStr = str(args.old_str);
                    if (!oldStr) return textResult('old_str 가 필요합니다.', true);
                    const content = await sandbox.readFile(path);
                    const count = content.split(oldStr).length - 1;
                    if (count === 0) return textResult(`old_str 를 찾을 수 없습니다: ${path}`, true);
                    if (count > 1) return textResult(`old_str 가 ${count}회 중복 — 유일해야 합니다.`, true);
                    await sandbox.writeFile(path, content.replace(oldStr, str(args.new_str)));
                    return textResult(`치환 완료: ${path}`);
                }
                if (command === 'insert') {
                    const content = await sandbox.readFile(path);
                    const lines = content.split('\n');
                    const at = Math.max(0, Math.min(lines.length, Number(args.insert_line) || 0));
                    lines.splice(at, 0, str(args.new_str));
                    await sandbox.writeFile(path, lines.join('\n'));
                    return textResult(`삽입 완료: ${path}:${at}`);
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
            description: '/workspace 파일 작업: op=read | write | list | delete.',
            inputSchema: {
                type: 'object',
                properties: {
                    op: { type: 'string', description: 'read | write | list | delete' },
                    path: { type: 'string', description: 'workspace 상대 경로 (list 는 기본 ".")' },
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
                if (op === 'write') { await sandbox.writeFile(path, str(args.content)); return textResult(`기록됨: ${path}`); }
                if (op === 'list') return textResult((await sandbox.listDir(path || '.')).join('\n') || '(빈 디렉토리)');
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
            description: '영속 컨테이너 내 chromium 으로 웹 브라우저를 자동화합니다(G2). actions 배열을 순서대로 실행: ' +
                'goto{url} · click{selector} · fill{selector,text} · press{key} · wait{ms} · waitFor{selector} · ' +
                'screenshot{path?} · extractText{selector?} · extractHtml{selector?}. 결과를 JSON 으로 반환합니다. ' +
                '네트워크는 샌드박스 정책(none/restricted)에 따라 제한됩니다.',
            inputSchema: {
                type: 'object',
                properties: {
                    actions: {
                        type: 'array',
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
                return textResult('브라우저 기능이 비활성화되어 있습니다 (TASK_SANDBOX_BROWSER_ENABLED=false).', true);
            }
            const actions = args.actions;
            if (!Array.isArray(actions) || actions.length === 0) {
                return textResult('actions 배열이 필요합니다.', true);
            }
            const spec = {
                actions,
                ...(Array.isArray(args.allowlist) ? { allowlist: args.allowlist } : {}),
            };
            try {
                await sandbox.writeFile('.browser-actions.json', JSON.stringify(spec));
            } catch (e) {
                return textResult(`액션 파일 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
            // 메인 샌드박스(network none)가 아닌 별도 일회성 컨테이너에서 실행.
            return formatExec(await sandbox.runBrowser('.browser-actions.json'));
        },
    };

    // ── G3 플래닝: 실행 계획 + step 상태 추적 ──
    const VALID_STATUS = new Set(['not_started', 'in_progress', 'completed', 'blocked']);
    const planCreate: MCPToolDefinition = {
        tool: {
            name: 'plan_create',
            description: '작업을 시작할 때 단계별 실행 계획을 세웁니다. steps 문자열 배열을 받아 추적 가능한 계획을 만듭니다. ' +
                '복잡한 작업은 먼저 이 도구로 계획하고, 진행하며 plan_update 로 상태를 갱신하세요.',
            inputSchema: {
                type: 'object',
                properties: { steps: { type: 'array', description: '단계 설명 문자열 배열' } },
                required: ['steps'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!Array.isArray(args.steps) || args.steps.length === 0) {
                return textResult('steps 배열이 필요합니다.', true);
            }
            plan.create(args.steps.map(String));
            return textResult(plan.render());
        },
    };

    const planUpdate: MCPToolDefinition = {
        tool: {
            name: 'plan_update',
            description: '계획 단계의 상태를 갱신합니다. step(1-based) + status(not_started|in_progress|completed|blocked).',
            inputSchema: {
                type: 'object',
                properties: {
                    step: { type: 'number', description: '단계 번호(1부터)' },
                    status: { type: 'string', description: 'not_started | in_progress | completed | blocked' },
                    note: { type: 'string', description: '메모(선택)' },
                },
                required: ['step', 'status'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const status = str(args.status);
            if (!VALID_STATUS.has(status)) return textResult(`status 는 ${[...VALID_STATUS].join('|')} 여야 합니다.`, true);
            const ok = plan.update(Number(args.step), status as PlanStepStatus, args.note !== undefined ? str(args.note) : undefined);
            if (!ok) return textResult(`단계 ${args.step} 가 범위를 벗어났습니다(계획 ${plan.length}단계).`, true);
            return textResult(plan.render());
        },
    };

    const planView: MCPToolDefinition = {
        tool: {
            name: 'plan_view',
            description: '현재 실행 계획과 각 단계 상태를 봅니다.',
            inputSchema: { type: 'object', properties: {} },
        },
        handler: async (): Promise<MCPToolResult> => textResult(plan.render()),
    };

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

    // ── #1 절차 스킬: 성공한 실행 절차를 저장(save)하고 LLM 재추론 없이 재생(run) ──
    const skillSave: MCPToolDefinition = {
        tool: {
            name: 'skill_save',
            description: '성공한 실행 절차를 재사용 가능한 스킬로 저장합니다. 같은 유형의 작업을 나중에 skill_run 으로 ' +
                'LLM 재추론 없이 재생할 수 있습니다. kind=browser 면 actions(browser 도구와 동일한 액션 배열), ' +
                'kind=script 면 lang+code 를 저장합니다. 반복되는 값(도시·기간 등)은 {{param}} 로 두고 params 에 이름을 나열하세요.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '스킬 이름(짧게)' },
                    description: { type: 'string', description: '이 절차가 달성하는 목표(매칭에 사용)' },
                    kind: { type: 'string', description: 'browser | script' },
                    actions: { type: 'array', description: 'kind=browser: browser 도구와 동일한 액션 배열' },
                    allowlist: { type: 'array', description: 'kind=browser: 허용 도메인 목록' },
                    lang: { type: 'string', description: 'kind=script: bash | python' },
                    code: { type: 'string', description: 'kind=script: 실행 코드({{param}} 치환 지원)' },
                    params: { type: 'array', description: '치환 파라미터 이름 목록(예: ["city","year"])' },
                },
                required: ['name', 'kind'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!procedural) return textResult('절차 스킬 저장이 비활성화되어 있습니다 (AGENT_TASK_PROCEDURAL_SKILLS=false).', true);
            const name = str(args.name).trim();
            const kind = str(args.kind);
            if (!name) return textResult('name 이 필요합니다.', true);
            if (kind !== 'browser' && kind !== 'script') return textResult('kind 는 browser | script 여야 합니다.', true);
            if (kind === 'browser' && !Array.isArray(args.actions)) return textResult('kind=browser 는 actions 배열이 필요합니다.', true);
            if (kind === 'script' && !str(args.code)) return textResult('kind=script 는 code 가 필요합니다.', true);
            const lang = args.lang === 'python' ? 'python' : args.lang === 'bash' ? 'bash' : undefined;
            try {
                const id = await procedural.save({
                    name,
                    description: str(args.description),
                    kind,
                    actions: Array.isArray(args.actions) ? args.actions : undefined,
                    allowlist: Array.isArray(args.allowlist) ? (args.allowlist as unknown[]).filter((d): d is string => typeof d === 'string') : undefined,
                    lang,
                    code: str(args.code) || undefined,
                    params: Array.isArray(args.params) ? (args.params as unknown[]).filter((p): p is string => typeof p === 'string') : undefined,
                });
                return textResult(`절차 스킬 저장됨: skill_id=${id}. 다음에 skill_run 으로 재생하세요.`);
            } catch (e) {
                return textResult(`스킬 저장 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    const skillRun: MCPToolDefinition = {
        tool: {
            name: 'skill_run',
            description: '저장된 절차 스킬을 skill_id 로 즉시 재생합니다(LLM 재추론 없이 전체 시퀀스 1회 실행). ' +
                'params 로 {{param}} 를 치환합니다. kind=browser 는 브라우저 액션을, kind=script 는 저장된 코드를 실행하고 결과를 반환합니다. ' +
                '재생 결과가 목표와 다르면 수동으로 진행하세요.',
            inputSchema: {
                type: 'object',
                properties: {
                    skill_id: { type: 'string', description: '재생할 절차 스킬 id' },
                    params: { type: 'object', description: '{{param}} 치환값 (예: {"city":"부산","year":"2026"})' },
                },
                required: ['skill_id'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!procedural) return textResult('절차 스킬 재생이 비활성화되어 있습니다 (AGENT_TASK_PROCEDURAL_SKILLS=false).', true);
            const skillId = str(args.skill_id).trim();
            if (!skillId) return textResult('skill_id 가 필요합니다.', true);
            const spec = await procedural.load(skillId).catch(() => null);
            if (!spec) return textResult(`절차 스킬을 찾지 못했습니다(또는 접근 불가): ${skillId}`, true);
            const params: Record<string, string> = {};
            if (args.params && typeof args.params === 'object') {
                for (const [k, v] of Object.entries(args.params as Record<string, unknown>)) params[k] = String(v);
            }
            const sub = (t: string): string => t.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in params ? params[k] : m));
            const deepSub = (v: unknown): unknown => {
                if (typeof v === 'string') return sub(v);
                if (Array.isArray(v)) return v.map(deepSub);
                if (v && typeof v === 'object') {
                    const o: Record<string, unknown> = {};
                    for (const k of Object.keys(v as Record<string, unknown>)) o[k] = deepSub((v as Record<string, unknown>)[k]);
                    return o;
                }
                return v;
            };
            try {
                if (spec.kind === 'browser') {
                    if (!sandbox.isBrowserEnabled) return textResult('브라우저 기능이 비활성화되어 있습니다 (TASK_SANDBOX_BROWSER_ENABLED=false).', true);
                    const renderedActions = deepSub(spec.actions ?? []);
                    const specOut = { actions: renderedActions, ...(Array.isArray(spec.allowlist) ? { allowlist: deepSub(spec.allowlist) } : {}) };
                    await sandbox.writeFile('.browser-actions.json', JSON.stringify(specOut));
                    return formatExec(await sandbox.runBrowser('.browser-actions.json'));
                }
                // kind === 'script'
                const code = sub(spec.code ?? '');
                if (!code) return textResult('재생할 코드가 비어 있습니다.', true);
                if (spec.lang === 'python') {
                    await sandbox.writeFile('.skill-run.py', code);
                    return formatExec(await sandbox.exec('python3 .skill-run.py'));
                }
                return formatExec(await sandbox.exec(code));
            } catch (e) {
                return textResult(`스킬 재생 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

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
            description: '진행에 사용자 확인이 필요할 때 호출합니다. task 가 일시정지되고 사용자에게 알림이 가며, ' +
                '사용자는 승인(계속 진행) 또는 거절로만 응답할 수 있습니다 — 예/아니오로 답할 수 있게 질문하세요.',
            inputSchema: {
                type: 'object',
                properties: { question: { type: 'string', description: '사용자에게 물을 질문' } },
                required: ['question'],
            },
        },
        handler: async (args): Promise<MCPToolResult> =>
            textResult(`${TASK_ASK_HUMAN_SENTINEL} ${str(args.question)}`),
    };

    return [bash, pythonExecute, strReplaceEditor, fileOps, browser, planCreate, planUpdate, planView, delegateTool, ...(spawn ? [spawnAgentsTool] : []), ...(procedural ? [skillSave, skillRun] : []), terminate, askHuman];
}
