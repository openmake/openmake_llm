/**
 * ============================================================
 * Agent Task Schema - 자율 에이전트 작업 Zod 검증 스키마
 * ============================================================
 *
 * @module schemas/agent-task.schema
 */
import { z } from 'zod';
import { secureTextSchema } from './security.schema';
import { AGENT_TASK_LIMITS, FILE_ATTACH_LIMITS } from '../config/runtime-limits';

/**
 * 작업 입력 첨부 파일 — 채팅 WS files[](WsAttachedFile) 와 동일 계약.
 * content 는 텍스트 내용, data 는 추출 대상 바이너리 문서(PDF/docx 등)의 base64 원본
 * (라우트가 doc-extractor 로 content 추출 후 폐기). 캡은 채팅 첨부와 동일 상수 재사용.
 */
const taskInputFileSchema = z.object({
    id: z.string().max(100).optional(),
    name: z.string().min(1).max(FILE_ATTACH_LIMITS.MAX_NAME_LENGTH),
    type: z.string().max(100).optional(),
    content: z.string().max(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE).optional(),
    // 전송 캡은 요청 body 상한과 정합(base64 문자열은 body 보다 클 수 없음) — 텍스트 추출
    // 가능 여부는 DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE 가 별도 결정(초과 시 추출만 생략,
    // 원본 바이트는 샌드박스 uploads/ 로 전달되어 에이전트가 직접 파싱).
    data: z.string().max(AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES).optional(),
    // 청크 업로드 참조 — /api/agent-task-uploads 로 완료(complete)된 업로드의 id.
    // 지정 시 content/data 대신 서버 디스크의 조립 원본을 storedPath 로 소모(claim)한다.
    uploadId: z.uuid().optional(),
    size: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
});

/**
 * 청크 업로드 세션 시작(init) 스키마 — 파일 선언(이름·크기·청크 수).
 * 청크당 크기 상한은 AGENT_TASK_LIMITS.CHUNK_MAX_BYTES(라우트 raw 파서와 스토어가 이중 검증).
 */
export const chunkedUploadInitSchema = z.strictObject({
    name: z.string().min(1).max(FILE_ATTACH_LIMITS.MAX_NAME_LENGTH),
    type: z.string().max(100).optional(),
    size: z.number().int().positive().max(AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES),
    totalChunks: z.number().int().min(1).max(AGENT_TASK_LIMITS.CHUNK_MAX_COUNT),
});
export type ChunkedUploadInitInput = z.infer<typeof chunkedUploadInitSchema>;

/**
 * 에이전트 작업 생성 스키마
 *
 * strict — 미선언 키는 strip 이 아니라 400 으로 거절한다. 조용한 strip 은 오타(`maxTurn`)나
 * 잘못된 위치의 옵션(`approvalPolicy`)을 "요청은 200 인데 설정만 안 먹는" 형태로 감춰서,
 * 증상만 보고는 원인을 알 수 없다.
 *
 * @property {string} goal - 작업 목표 (1자~AGENT_TASK_LIMITS.GOAL_MAX_CHARS, 필수)
 * @property {number} [maxTurns] - 최대 도구 루프 턴 수 (1~상한, 기본값: DEFAULT_MAX_TURNS)
 * @property {Array} [files] - 입력 첨부 파일 (채팅 첨부와 동일 캡)
 * @property {Array} [images] - 입력 첨부 이미지 dataURL (vision 채널 전달)
 */
export const createAgentTaskSchema = z.strictObject({
    goal: secureTextSchema({ minLength: 1, maxLength: AGENT_TASK_LIMITS.GOAL_MAX_CHARS, fieldName: 'goal', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
    // Cowork D1a: 실행 백엔드 — 'local' 은 LOCAL_EXECUTOR_ENABLED + 디바이스 연결 필요(라우트가 검증).
    executor: z.enum(['sandbox', 'local']).optional(),
    files: z.array(taskInputFileSchema).max(FILE_ATTACH_LIMITS.MAX_FILES).optional(),
    images: z.array(
        z.string().startsWith('data:image/').max(FILE_ATTACH_LIMITS.MAX_IMAGE_DATAURL_CHARS)
    ).max(FILE_ATTACH_LIMITS.MAX_IMAGES).optional(),
    // Phase 2 Git: 작업 대상 repo(https://github.com/org/repo)·브랜치. 있으면 실행 시 호스트가 clone.
    // 엄격한 형식 검증은 서버 parseGithubRepo 가 수행 — 여기선 prefix·길이·안전문자만.
    repoUrl: z.string().startsWith('https://github.com/').max(300).optional(),
    branch: z.string().max(200).regex(/^[A-Za-z0-9._/-]+$/).optional(),
    // 승인 정책은 **실행 단위** 옵션이라 생성이 아니라 execute 에 넘긴다. 여기 실리면
    // 조용히 버려져(비-strict 객체는 미선언 키를 strip) "정책을 none 으로 줬는데 첫 도구에서
    // 승인 대기" 로만 보인다 — 원인이 드러나지 않으므로 명시적으로 거절한다.
    approvalPolicy: z.never({
        error: '승인 정책은 생성이 아니라 POST /api/agent-tasks/:taskId/execute 에 전달하세요',
    }).optional(),
});

/** 에이전트 작업 생성 요청 TypeScript 타입 */
export type CreateAgentTaskInput = z.infer<typeof createAgentTaskSchema>;

/**
 * 에이전트 작업 실행(execute) 요청 스키마 — 승인 3모드(Manual/Auto/Skip)를 이 실행에 한해 지정.
 * all=Manual(전부 승인·기본), high-risk=Auto(고위험만), none=Skip(전부 자동). 미지정 시 전역 정책.
 *
 * 생성 스키마와 같은 이유로 strict. allowedSkills 도 여기 선언해야 한다 — 라우트가 body 에서
 * 직접 읽으므로 스키마에서 빠지면 미들웨어가 검증된 body 로 치환할 때 통째로 사라진다.
 */
export const executeAgentTaskSchema = z.strictObject({
    approvalPolicy: z.enum(['all', 'high-risk', 'none']).optional(),
    /** 이 실행에서 쓸 skill_id 목록 — 미지정이면 전체 활성 스킬. */
    allowedSkills: z.array(z.string().min(1).max(200)).max(AGENT_TASK_LIMITS.EXECUTE_MAX_ALLOWED_SKILLS).optional(),
});
export type ExecuteAgentTaskInput = z.infer<typeof executeAgentTaskSchema>;

/**
 * 스케줄(반복 트리거) 생성 스키마 (Phase 3-A).
 * cron 또는 intervalSeconds 중 정확히 하나만 지정. interval 은 최소 간격 강제(남용 방지).
 * cron 표현식 유효성은 라우트에서 parseCron 으로 추가 검증.
 */
export const createAgentTaskScheduleSchema = z.object({
    goal: secureTextSchema({ minLength: 1, maxLength: AGENT_TASK_LIMITS.GOAL_MAX_CHARS, fieldName: 'goal', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    cron: z.string().min(1).max(120).optional(),
    intervalSeconds: z.number().int().min(AGENT_TASK_LIMITS.SCHEDULE_MIN_INTERVAL_SEC).max(365 * 24 * 3600).optional(),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
}).refine((v) => (!!v.cron) !== (v.intervalSeconds !== undefined), {
    message: 'cron 또는 intervalSeconds 중 정확히 하나를 지정하세요.',
});

/** 스케줄 부분 수정 스키마 — 제공된 필드만 갱신. */
export const updateAgentTaskScheduleSchema = z.object({
    goal: secureTextSchema({ minLength: 1, maxLength: AGENT_TASK_LIMITS.GOAL_MAX_CHARS, fieldName: 'goal', allowHtmlLikeContent: true, detectMaliciousPatterns: false }).optional(),
    cron: z.string().min(1).max(120).nullable().optional(),
    intervalSeconds: z.number().int().min(AGENT_TASK_LIMITS.SCHEDULE_MIN_INTERVAL_SEC).max(365 * 24 * 3600).nullable().optional(),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
    enabled: z.boolean().optional(),
});

export type CreateAgentTaskScheduleInput = z.infer<typeof createAgentTaskScheduleSchema>;
export type UpdateAgentTaskScheduleInput = z.infer<typeof updateAgentTaskScheduleSchema>;

/** 템플릿 파라미터 정의(6-1) — {{name}} 자리 치환. */
const templateParamSchema = z.object({
    name: z.string().min(1).max(50).regex(/^[A-Za-z0-9_가-힣-]+$/, '파라미터 이름은 영숫자·한글·_·- 만 허용'),
    description: z.string().max(200).optional(),
    default: z.string().max(500).optional(),
});

/** 작업 템플릿 생성 스키마(6-1). goal_template 은 secureText(HTML 태그 금지 등) 적용. */
export const createAgentTaskTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    goalTemplate: secureTextSchema({ minLength: 1, maxLength: AGENT_TASK_LIMITS.GOAL_MAX_CHARS, fieldName: 'goalTemplate', allowHtmlLikeContent: true, detectMaliciousPatterns: false }),
    params: z.array(templateParamSchema).max(10).optional(),
    maxTurns: z.number().int().min(1).max(AGENT_TASK_LIMITS.MAX_TURNS_CEILING).optional(),
});

export const updateAgentTaskTemplateSchema = createAgentTaskTemplateSchema.partial();

/** 템플릿 instantiate 입력 — 파라미터 값 맵. */
export const instantiateTemplateSchema = z.object({
    values: z.record(z.string(), z.string().max(2000)).optional(),
    /** true(기본): 생성 즉시 실행(큐 경유). false: 생성만. */
    execute: z.boolean().optional(),
});

export type CreateAgentTaskTemplateInput = z.infer<typeof createAgentTaskTemplateSchema>;
export type UpdateAgentTaskTemplateInput = z.infer<typeof updateAgentTaskTemplateSchema>;
export type InstantiateTemplateInput = z.infer<typeof instantiateTemplateSchema>;
