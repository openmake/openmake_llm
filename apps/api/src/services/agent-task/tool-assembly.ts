/**
 * Agent Task LLM 도구 세트 조립 — AgentTaskService 에서 분리 (파일 크기 가드).
 *
 * 샌드박스 활성 시: 샌드박스 도구 + 정적 extraTools 화이트리스트 + (2-A) 목표 관련 동적 도구를
 * 조립한다. 전체 MCP 카탈로그(~150)는 vLLM 문법 컴파일 폭주를 유발하므로 예산으로 캡한다.
 * extraToolNames 는 호스트 실행(비-샌드박스) 도구 집합 — 디스패치가 HITL 승인 게이트 적용에 쓴다.
 *
 * @module services/agent-task/tool-assembly
 */
import type { ToolDefinition } from '../../llm/types';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { selectRelevantTools } from './tool-selector';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

export interface AssembledTools {
    tools: ToolDefinition[];
    /** 호스트에서 실행되는 비-샌드박스 도구 이름(extra + 동적) — 디스패치가 승인 게이트 적용. */
    extraToolNames: Set<string>;
}

/**
 * LLM 에 전달할 도구 세트를 조립. taskRuntime 유무·샌드박스 enabled 여부로 3분기.
 */
export function assembleAgentTools(params: {
    mcpTools: ToolDefinition[];
    taskRuntime: TaskRuntime | null;
    sandboxCfg: TaskSandboxConfig;
    goal: string;
}): AssembledTools {
    const { mcpTools, taskRuntime, sandboxCfg, goal } = params;
    const extraToolNames = new Set<string>();

    // 샌드박스로 대체 불가한 소수 고가치 내장 도구(extraTools 화이트리스트)를 이름으로 선별.
    const buildExtra = (sandboxToolNames: Set<string>): ToolDefinition[] => {
        const extra: ToolDefinition[] = [];
        for (const name of sandboxCfg.extraTools) {
            // 샌드박스 도구와 이름 충돌 시 제외(중복 function.name 으로 인한 요청 거부·섀도잉 방지).
            if (sandboxToolNames.has(name)) {
                logger.warn(`[AgentTask] extraTools '${name}' 가 샌드박스 도구와 이름 충돌 — 무시`);
                continue;
            }
            const tool = mcpTools.find((t) => t.function.name === name);
            if (!tool) {
                logger.warn(`[AgentTask] extraTools '${name}' 를 도구 카탈로그에서 찾지 못함 — 노출 생략`);
                continue;
            }
            extra.push(tool);
            extraToolNames.add(name);
        }
        return extra;
    };

    if (taskRuntime) {
        const sandboxTools = taskRuntime.getLLMTools();
        const sandboxNames = new Set(sandboxTools.map((t) => t.function.name));
        const staticExtra = buildExtra(sandboxNames);
        // 2-A 동적 도구: 목표 관련성 top-K MCP 도구를 예산 내에서 합류. 호스트 실행이므로
        // extraToolNames 에 등록해 디스패치가 extra 도구와 동일하게 HITL 승인 게이트를 적용한다.
        // 관련성 0 도구는 selectRelevantTools 가 제외 → 문법 컴파일 폭주 재유발 없음.
        let dynamicExtra: ToolDefinition[] = [];
        if (AGENT_TASK_LIMITS.DYNAMIC_TOOLS_ENABLED) {
            const budget = AGENT_TASK_LIMITS.DYNAMIC_TOOLS_BUDGET - sandboxTools.length - staticExtra.length;
            dynamicExtra = selectRelevantTools(goal, mcpTools, {
                budget,
                exclude: new Set<string>([...sandboxNames, ...extraToolNames]),
            });
            for (const t of dynamicExtra) extraToolNames.add(t.function.name);
            if (dynamicExtra.length > 0) {
                logger.info(`[AgentTask] 동적 도구 ${dynamicExtra.length}개 합류 (예산 ${budget}, 총 ${sandboxTools.length + staticExtra.length + dynamicExtra.length})`);
            }
        }
        return { tools: [...staticExtra, ...dynamicExtra, ...sandboxTools], extraToolNames };
    }

    if (sandboxCfg.enabled) {
        // 샌드박스 ENABLED 인데 생성 실패(degrade): 전체 카탈로그(~150)는 hang 을 유발하므로
        // 화이트리스트 도구만으로 진행 — 셸 작업은 불가하나 검색·이미지·작성 작업은 계속 가능.
        const tools = buildExtra(new Set<string>());
        logger.warn(`[AgentTask] 샌드박스 미가용 — extraTools(${extraToolNames.size}개)만으로 진행 (전체 카탈로그 미전달)`);
        return { tools, extraToolNames };
    }

    // 샌드박스 OFF(legacy) 경로 — 기존대로 전체 MCP 도구 사용.
    return { tools: mcpTools, extraToolNames };
}
