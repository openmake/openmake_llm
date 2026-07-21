/**
 * Agent Task 공용 타입/에러 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/types
 */
import type { ChatMessage } from '../../llm/types';
import type { AttachedFileInput } from '../chat-service/attach-context';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';

export type AgentTaskUserRole = 'admin' | 'user' | 'guest';

/** 루프 종료 사유를 명확히 구분하기 위한 내부 에러 */
export class AgentTaskAbort extends Error {
    constructor(public readonly kind: 'aborted' | 'timeout' | 'token_limit') {
        super(kind);
        this.name = 'AgentTaskAbort';
    }
}

/** runaway 가드 — 한도 초과 시 종류별 AgentTaskAbort throw (AgentTaskService 에서 분리 — 파일 크기 가드).
 *  pausedMs(승인 대기 누적)는 활성 시간이 아니므로 타임아웃 예산에서 제외(4-1). */
export function assertWithinLimits(signal: AbortSignal, startedAt: number, pausedMs: number, totalTokens: number): void {
    if (signal.aborted) throw new AgentTaskAbort('aborted');
    if (Date.now() - startedAt - pausedMs > AGENT_TASK_LIMITS.TOTAL_TIMEOUT_MS) {
        throw new AgentTaskAbort('timeout');
    }
    if (totalTokens > AGENT_TASK_LIMITS.MAX_TOTAL_TOKENS) {
        throw new AgentTaskAbort('token_limit');
    }
}

/** 작업 입력 첨부 파일 — 생성 라우트가 doc-extractor 로 추출·저장한 형태. */
export interface AgentTaskInputFile extends AttachedFileInput {
    /** 바이너리 문서(PDF/docx 등)에서 추출된 텍스트임 — workspace 기록 시 .txt 확장자 부여 */
    extracted?: boolean;
}

export interface AgentTaskRunInput {
    taskId: string;
    goal: string;
    userId: string;
    userRole: AgentTaskUserRole;
    maxTurns: number;
    /** 이 실행에서 사용할 스킬 범위(skill_id 목록). 지정 시 활성 스킬 바인딩을 이 집합으로 제한.
     *  미지정/빈 배열이면 사용자 전체 활성 스킬 사용(기존 동작). */
    allowedSkills?: string[];
    /** 입력 첨부 파일(추출 텍스트+원본 base64) — 샌드박스 ON 이면 workspace(uploads/)에 기록,
     *  OFF 면 goal 메시지에 fileContext 로 주입(신규 시작에 한함). */
    files?: AgentTaskInputFile[];
    /** 입력 첨부 이미지(dataURL) — goal 메시지 vision 채널로 주입(신규 시작에 한함),
     *  샌드박스 ON 이면 uploads/ 에 원본 바이트로도 기록. */
    images?: string[];
    /** resume(이어하기): 기존 end-of-turn checkpoint 에서 복원 */
    resume?: {
        conversation: ChatMessage[];
        fromTurn: number;
        fromStep: number;
    };
}
