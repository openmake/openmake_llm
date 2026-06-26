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
 * 두 도구는 sentinel 결과를 반환하고, 실제 루프 해석(종료/일시정지)은 AgentTaskService
 * 배선 증분에서 처리한다(현재 미배선 — 운영 안전).
 *
 * @module services/task-sandbox/tools
 */
import type { MCPToolDefinition, MCPToolResult } from '../../mcp/types';
import type { TaskSandbox, ExecResult } from './sandbox';
import { TaskPlan, type PlanStepStatus } from './planning';

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
export function createTaskTools(sandbox: TaskSandbox, plan: TaskPlan = new TaskPlan()): MCPToolDefinition[] {
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
            return formatExec(await sandbox.exec('node /opt/browser/browser-runner.mjs .browser-actions.json'));
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
            description: '진행에 사용자 입력/승인이 필요할 때 호출합니다. task 가 일시정지되고 사용자에게 알림이 갑니다.',
            inputSchema: {
                type: 'object',
                properties: { question: { type: 'string', description: '사용자에게 물을 질문' } },
                required: ['question'],
            },
        },
        handler: async (args): Promise<MCPToolResult> =>
            textResult(`${TASK_ASK_HUMAN_SENTINEL} ${str(args.question)}`),
    };

    return [bash, pythonExecute, strReplaceEditor, fileOps, browser, planCreate, planUpdate, planView, terminate, askHuman];
}
