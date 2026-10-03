/**
 * 절차 스킬 도구 — skill_save(성공한 실행 절차를 저장) · skill_run(LLM 재추론 없이 재생).
 * tools.ts 에서 분리했다(파일 크기 관문). 공용 도우미는 tools.ts 가 넘겨준다(순환 import 방지).
 *
 * @module services/task-sandbox/tools-procedural
 */
import type { MCPToolDefinition, MCPToolResult } from '../../tool-contract/types';
import type { TaskExecutor, ExecResult } from './executor';
import { procedureChecksum, SKILL_RUN_CHECKSUM_ARG } from './skill-run-binding';
import { findPlaintextSecrets } from '../agent-task/procedural-secrets';
import { proceduralSecretRejection } from '../../prompts/procedural-skill-prompt';

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
        /** 해석된 스킬 id — 재생 결과 기록에 쓴다(이름으로 매칭된 경우에도 실제 id). */
        id?: string;
        kind: 'browser' | 'script';
        actions?: unknown[];
        allowlist?: string[];
        lang?: 'bash' | 'python';
        code?: string;
    } | null>;
    /** 재생이 끝난 뒤 결과를 한 번 기록한다(관측용 — 실패해도 재생을 막지 않는다). */
    recordRun?: (run: { skillId: string; kind: 'browser' | 'script'; status: 'ok' | 'error'; durationMs: number }) => void;
}

/** tools.ts 의 공용 도우미 — 결과 포맷·임시 파일 실행. */
interface ProceduralToolHelpers {
    textResult: (text: string, isError?: boolean) => MCPToolResult;
    str: (v: unknown) => string;
    formatExec: (r: ExecResult) => MCPToolResult;
    runFresh: (
        sandbox: TaskExecutor, name: { dir?: string; prefix: string; ext: string }, content: string,
        run: (relPath: string) => Promise<ExecResult>,
    ) => Promise<{ result: ExecResult; relPath: string }>;
    browserUnavailable: string;
}

/** [skill_save, skill_run] 정의 — procedural 훅이 없으면(플래그 OFF) 핸들러가 비활성 안내를 돌려준다. */
export function createProceduralTools(
    sandbox: TaskExecutor,
    procedural: ProceduralHooks | undefined,
    browserMetrics: ((stdout: string) => void) | undefined,
    h: ProceduralToolHelpers,
): [MCPToolDefinition, MCPToolDefinition] {
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
            if (!procedural) return h.textResult('절차 스킬 저장이 비활성화되어 있습니다 (AGENT_TASK_PROCEDURAL_SKILLS=false).', true);
            const name = h.str(args.name).trim();
            const kind = h.str(args.kind);
            if (!name) return h.textResult('name 이 필요합니다.', true);
            if (kind !== 'browser' && kind !== 'script') return h.textResult('kind 는 browser | script 여야 합니다.', true);
            if (kind === 'browser' && !Array.isArray(args.actions)) return h.textResult('kind=browser 는 actions 배열이 필요합니다.', true);
            if (kind === 'script' && !h.str(args.code)) return h.textResult('kind=script 는 code 가 필요합니다.', true);
            const lang = args.lang === 'python' ? 'python' : args.lang === 'bash' ? 'bash' : undefined;
            // 평문 비밀 값은 저장하지 않는다 — {{param}} 으로 일반화해 다시 저장하게 돌려준다.
            const secrets = findPlaintextSecrets({ kind, actions: Array.isArray(args.actions) ? args.actions : undefined, code: h.str(args.code) || undefined });
            if (secrets.length > 0) return h.textResult(proceduralSecretRejection(secrets), true);
            try {
                const id = await procedural.save({
                    name,
                    description: h.str(args.description),
                    kind,
                    actions: Array.isArray(args.actions) ? args.actions : undefined,
                    allowlist: Array.isArray(args.allowlist) ? (args.allowlist as unknown[]).filter((d): d is string => typeof d === 'string') : undefined,
                    lang,
                    code: h.str(args.code) || undefined,
                    params: Array.isArray(args.params) ? (args.params as unknown[]).filter((p): p is string => typeof p === 'string') : undefined,
                });
                return h.textResult(`절차 스킬 저장됨: skill_id=${id}. 다음에 skill_run 으로 재생하세요.`);
            } catch (e) {
                return h.textResult(`스킬 저장 실패: ${e instanceof Error ? e.message : String(e)}`, true);
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
                    skill_id: { type: 'string', description: '재생할 절차 스킬 id(정확한 skill_id 권장). 미스 시 스킬 이름/설명으로도 매칭됩니다.' },
                    params: { type: 'object', description: '{{param}} 치환값 (예: {"city":"부산","year":"2026"})' },
                },
                required: ['skill_id'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!procedural) return h.textResult('절차 스킬 재생이 비활성화되어 있습니다 (AGENT_TASK_PROCEDURAL_SKILLS=false).', true);
            const skillId = h.str(args.skill_id).trim();
            if (!skillId) return h.textResult('skill_id 가 필요합니다.', true);
            const spec = await procedural.load(skillId).catch(() => null);
            if (!spec) return h.textResult(`절차 스킬을 찾지 못했습니다(또는 접근 불가): ${skillId}`, true);
            // 승인 결속 — 승인 때 본 절차와 지금 절차가 다르면 실행하지 않는다(skill-run-binding).
            const bound = args[SKILL_RUN_CHECKSUM_ARG];
            if (typeof bound === 'string' && bound !== procedureChecksum(spec)) {
                return h.textResult(`승인 뒤 절차 스킬 내용이 바뀌었습니다: ${skillId} — skill_run 을 다시 호출해 바뀐 내용으로 승인받으세요.`, true);
            }
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
            const started = Date.now();
            const replay = async (): Promise<MCPToolResult> => {
            try {
                if (spec.kind === 'browser') {
                    if (!sandbox.isBrowserEnabled) return h.textResult(h.browserUnavailable, true);
                    const renderedActions = deepSub(spec.actions ?? []);
                    const specOut = {
                        actions: renderedActions,
                        ...(Array.isArray(spec.allowlist) ? { allowlist: deepSub(spec.allowlist) } : {}),
                        ...(sandbox.browserStatePath ? { statePath: sandbox.browserStatePath } : {}),
                    };
                    const { result: r } = await h.runFresh(
                        sandbox, { prefix: '.browser-actions', ext: '.json' }, JSON.stringify(specOut),
                        (p) => sandbox.runBrowser(p),
                    );
                    browserMetrics?.(r.stdout); // Stage 0 계측(fail-open)
                    return h.formatExec(r);
                }
                // kind === 'script'
                const code = sub(spec.code ?? '');
                if (!code) return h.textResult('재생할 코드가 비어 있습니다.', true);
                if (spec.lang === 'python') {
                    const { result } = await h.runFresh(
                        sandbox, { prefix: '.skill-run', ext: '.py' }, code, (p) => sandbox.exec(`python3 ${p}`),
                    );
                    return h.formatExec(result);
                }
                return h.formatExec(await sandbox.exec(code));
            } catch (e) {
                return h.textResult(`스킬 재생 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
            };
            const out = await replay();
            // 재생 결과 기록 — 조회가 아니라 재생이 끝난 뒤 한 번(성공·실패, 소요 시간).
            try {
                procedural.recordRun?.({ skillId: spec.id ?? skillId, kind: spec.kind, status: out.isError ? 'error' : 'ok', durationMs: Date.now() - started });
            } catch { /* 기록 실패는 재생 결과에 영향 없음 */ }
            return out;
        },
    };

    return [skillSave, skillRun];
}
