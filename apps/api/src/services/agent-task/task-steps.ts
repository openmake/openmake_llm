/**
 * Agent Task 스텝 영속·도구 실행 결과 처리 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/task-steps
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ExtractedArtifact } from '../../llm/artifact-parser';
import type { ArtifactKind } from '../../data/repositories/artifact-repository';
import { takeReportSource } from '../chat-service/report-block';
import { MAX_TOOL_RESULT_CHARS, AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { recordToolResultTruncation } from '../tool-result-truncation-recorder';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/** tool name 이 검색/정보수집류인지 (키워드 포함 여부) — 검색 폭주 하드 제한용 */
export function isSearchTool(name: string): boolean {
    const n = name.toLowerCase();
    return AGENT_TASK_LIMITS.SEARCH_TOOL_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Agent Task 아티팩트의 합성 session_id — 채팅 세션과 네임스페이스를 분리한다.
 * artifacts 테이블은 session_id NOT NULL 이고 (session_id, artifact_id, version) 이 유니크라,
 * task 별로 고유한 값을 주면 스키마 변경 없이 같은 저장소를 공유할 수 있다.
 */
export function taskArtifactSessionId(taskId: string): string {
    return `task:${taskId}`;
}

/**
 * 최종 답변에서 추출한 deliverable 아티팩트를 영속화한다 — 두 곳에 저장한다:
 *
 *   1. agent_task_steps(step_type='artifact') — 작업 타임라인 표시용(기존 동작).
 *   2. artifacts 테이블 — 채팅 산출물과 같은 아티팩트 갤러리에 노출.
 *
 * 2가 없던 동안 에이전트 작업 산출물은 갤러리에 아예 나타나지 않아, 작업 상세 모달의
 * 스텝 타임라인에서 원시 JSON 을 4,000자만 잘라 보는 것 외에는 확인할 방법이 없었다.
 * listLatestByUser 가 user_id 기준이라 합성 session_id 로도 갤러리에 정상 노출된다.
 *
 * 저장 실패는 작업을 실패시키지 않는다 (result 본문은 이미 보존됨). 두 저장은 서로
 * 독립적으로 try 한다 — 갤러리 저장이 실패해도 타임라인 스텝은 남는다.
 */
export async function persistArtifactSteps(
    taskId: string,
    artifacts: ExtractedArtifact[],
    stepNumber: number,
    userId?: string,
): Promise<number> {
    const db = getUnifiedDatabase();
    for (const artifact of artifacts) {
        // 보고서 아티팩트면 reportdata 원본을 함께 보존 — docx 등 구조 기반 export 용.
        // take 는 1회 회수(렌더 대기열 pendingReportSources 정리를 겸함)라 루프 선두에서
        // 한 번만 꺼내 스텝 JSON 과 갤러리 row 양쪽에 쓴다.
        const sourceData = takeReportSource(artifact.id);
        try {
            await db.addAgentTaskStep({
                taskId,
                stepNumber: stepNumber++,
                stepType: 'artifact',
                toolName: artifact.kind,
                content: JSON.stringify(sourceData ? { ...artifact, sourceData } : artifact),
            });
        } catch (e) {
            logger.warn(`[AgentTask] 아티팩트 스텝 저장 실패: ${taskId} — ${e}`);
        }

        // 갤러리 노출용 — 스텝 저장과 독립. 20MB 초과(ArtifactSizeError) 등은 warn 만 남긴다.
        try {
            const { ArtifactRepository } = await import('../../data/repositories/artifact-repository');
            const { getPool } = await import('../../data/models/unified-database');
            // artifacts.session_id 는 conversation_sessions(id) 를 참조하는 FK 다 — 합성 세션 행을
            // 먼저 만들어 두지 않으면 insert 가 통째로 실패한다. 메시지가 없는 세션이라
            // 채팅 목록에는 뜨지 않는다(getSessionsByUserId 가 conversation_messages EXISTS 로 거른다).
            await getPool().query(
                `INSERT INTO conversation_sessions (id, user_id, title)
                 VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
                [taskArtifactSessionId(taskId), userId ?? null, `[task] ${artifact.title}`.slice(0, 200)],
            );
            await new ArtifactRepository(getPool()).insertArtifact({
                artifactId: artifact.id,
                sessionId: taskArtifactSessionId(taskId),
                userId: userId ?? null,
                // 채팅 경로(request-handler)와 동일 — 파서의 kind 는 string 이라 캐스팅한다.
                kind: artifact.kind as ArtifactKind,
                title: artifact.title,
                language: artifact.lang ?? null,
                content: artifact.content,
                ...(sourceData ? { sourceData } : {}),
            });
        } catch (e) {
            logger.warn(`[AgentTask] 아티팩트 갤러리 저장 실패: ${taskId} — ${e}`);
        }
    }
    return stepNumber;
}

/** 단일 도구 실행 — sandbox 는 executeToolWithContext 가 처리. 실패는 문자열로 흡수 */
export async function runTool(
    mcp: ReturnType<typeof getUnifiedMCPClient>,
    name: string,
    args: Record<string, unknown>,
    userCtx: UserContext,
): Promise<string> {
    try {
        const r = await mcp.executeToolWithContext(name, args, userCtx);
        // 문자열/JSON 양쪽 모두 캡 적용 — 대형 결과가 통째로 대화에 들어가면
        // 컨텍스트·체크포인트가 부풀어 token_limit abort 로 작업이 실패한다.
        const raw = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
        // G3 셰도우 계측 — 절단 발생률/폭 실측 (chunk-요약 도입 판단 게이트, fire-and-forget)
        recordToolResultTruncation({
            path: 'agent_task', toolName: name, rawChars: raw.length, capChars: MAX_TOOL_RESULT_CHARS,
        });
        const text = raw.length > MAX_TOOL_RESULT_CHARS
            ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...[결과가 길어 잘렸습니다]'
            : raw;
        return r.isError ? `Error: ${text}` : text;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[AgentTask] 도구 실행 실패 (${name}): ${msg}`);
        return `Error: ${msg}`;
    }
}

/**
 * judge 판정을 스텝으로 영속 — 사후 규명용. 종전엔 라벨(judge_verdict)만 남아 오판 원인을
 * 복원할 수 없었다. 실패해도 완료 흐름을 막지 않는다(fail-open, 관측 전용).
 *
 * `opts.shadow` 는 **적용되지 않은** 판정(아티팩트가 있어 완료가 이미 확정된 경우)이다.
 * step_type 을 'judge_shadow' 로 갈라 집계에서 섞이지 않게 하고, 본문 첫 줄에 반영되지
 * 않았음을 명시한다 — 상세 화면에 그대로 보이므로 "미달성인데 완료" 로 읽히면 안 된다.
 */
export async function persistJudgeStep(
    taskId: string,
    stepNumber: number,
    verdict: string,
    reason: string,
    raw: string,
    executionContext: string,
    opts: { shadow?: boolean } = {},
): Promise<number> {
    const content = [
        ...(opts.shadow ? ['[셰도우 계측 — 완료 여부에 반영되지 않음]'] : []),
        `판정: ${verdict}`,
        reason ? `사유: ${reason}` : `사유: (파싱 실패) ${raw}`,
        `입력 요약:\n${executionContext}`,
    ].join('\n');
    try {
        await getUnifiedDatabase().addAgentTaskStep({
            taskId, stepNumber, stepType: opts.shadow ? 'judge_shadow' : 'judge', content,
        });
        return stepNumber + 1;
    } catch (e) {
        logger.warn(`[AgentTask] judge 스텝 영속 실패(무시): ${taskId} — ${e instanceof Error ? e.message : e}`);
        return stepNumber;
    }
}
