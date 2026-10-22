/**
 * 런타임 제한값 — 응답 스크립트 순수성, 에이전트 작업(AGENT_TASK_LIMITS).
 * 공개 진입점은 config/runtime-limits(이 파일을 re-export) — 소비처는 그쪽에서 import 한다.
 *
 * @module config/runtime-limits-agent-task
 */

/**
 * 응답 스크립트 순수성 교정 (2026-08-02) — 한글 문장에 섞인 한자·가나를 후단에서 교정.
 * 프롬프트 강화로는 혼입률이 내려가지 않아(A/B 45% 유지) 후단 교정으로 처리한다.
 * 상세 근거는 services/chat-service/script-purity.ts 참고.
 */
export const SCRIPT_PURITY = {
    /** false 면 교정 LLM 호출 자체를 하지 않음(전체 비활성). */
    ENABLED: process.env.CHAT_SCRIPT_PURITY_REPAIR !== 'false',
    /** 혼입 줄이 이보다 많으면 교정 생략 — 줄 단위 교정의 이점이 사라지는 구간. */
    MAX_LINES: parseInt(process.env.CHAT_SCRIPT_PURITY_MAX_LINES || '20', 10),
    /** 교정 호출 전용 타임아웃 — 응답 완료 후 추가 지연이므로 짧게. */
    TIMEOUT_MS: parseInt(process.env.CHAT_SCRIPT_PURITY_TIMEOUT_MS || '20000', 10),
    /** 교정 출력 상한. 혼입 줄만 되돌려받으므로 본문 전체보다 훨씬 작다. */
    MAX_OUTPUT_TOKENS: parseInt(process.env.CHAT_SCRIPT_PURITY_MAX_TOKENS || '1200', 10),
    /** 교정 호출 temperature — 결정적 재작성이 목적이라 0 고정 기본. */
    TEMPERATURE: Number(process.env.CHAT_SCRIPT_PURITY_TEMPERATURE || '0'),
    /** 교정본이 원문 대비 이 비율보다 짧으면 내용 유실로 보고 그 줄은 원문 유지. */
    MIN_LENGTH_RATIO: 0.5,
    /**
     * 교정 프롬프트. 성공 기준("하나라도 남으면 실패")과 단어 단위 매핑 예시가 핵심 —
     * 이 둘이 없던 초기 문구는 어려운 케이스(중국어 단어가 통째로 섞인 경우)를 0/5 로
     * 전혀 고치지 못했고, 추가 후 5/5 로 바뀌었다(2026-08-02 A/B).
     * 예시는 라이브에서 실제 교정에 실패했던 문장들에서 뽑았다.
     */
    SYSTEM_PROMPT: [
        '당신은 한국어 교정기입니다. 각 줄에서 한글이 아닌 문자(한자·중국어 간체자·일본어 가나)를',
        '문맥에 맞는 한국어로 빠짐없이 바꾸세요. 출력에 한자가 하나라도 남아 있으면 실패입니다.',
        '',
        '중국어 단어가 통째로 섞인 경우가 많습니다. 글자마다 음차하지 말고 단어 전체를 한국어로 옮기세요:',
        '- 주도下的 기술 → 주도하는 기술',
        '- 전交易日 → 전 거래일',
        '- 前次会议 → 지난 회의',
        '- 影响 → 영향,  除外 → 제외,  开发商 → 개발사,  当天 → 당일,  支出 → 지출',
        '',
        '그 외의 내용·수치·마크다운 서식은 절대 바꾸지 마세요.',
        '입력과 같은 "번호. 내용" 형식으로, 입력된 줄 수만큼만 출력하세요. 설명은 붙이지 마세요.',
    ].join('\n'),
} as const;

/**
 * 자율 에이전트 작업 (AgentTaskService) runaway 가드 한계.
 * 백그라운드 detached 실행이라 사람이 지켜보지 않으므로 토큰/시간 폭주 방지가 필수.
 */
export const AGENT_TASK_LIMITS = {
    /** 작업당 유지하는 턴 체크포인트 이력 수(141). AGENT_TASK_CHECKPOINT_KEEP */
    CHECKPOINT_KEEP: parseInt(process.env.AGENT_TASK_CHECKPOINT_KEEP || '20', 10),
    /** 실행 중 계획 편집 다음 턴 반영(139). AGENT_TASK_PLAN_EDIT_ENABLED */
    PLAN_EDIT_ENABLED: process.env.AGENT_TASK_PLAN_EDIT_ENABLED !== 'false',
    /** 작업 생성 요청 body 상한(bytes) — /api/agent-tasks 의 express.json 파서와 validate
     *  미들웨어(maxBodySizeBytes)가 공유하는 단일 소스(정합 고정: 파서만 크고 검증이 1MB 로
     *  거부하던 불일치 방지). 첨부는 base64 로 4/3 팽창하므로 원본 파일 실효 상한은 약 3/4.
     *  AGENT_TASK_BODY_MAX_BYTES(기본 1000MB). */
    REQUEST_BODY_MAX_BYTES: parseInt(process.env.AGENT_TASK_BODY_MAX_BYTES || '', 10) || 1000 * 1024 * 1024,
    /** 입력 첨부 원본 저장 루트(호스트) — multipart 업로드가 디스크로 스트리밍되는 위치.
     *  base64-in-JSON 경로와 달리 메모리에 body 를 올리지 않는다. task 삭제 시 함께 정리.
     *  AGENT_TASK_UPLOAD_ROOT(기본 <cwd>/data/uploads/agent-tasks). */
    UPLOAD_ROOT: process.env.AGENT_TASK_UPLOAD_ROOT
        || `${process.cwd()}/data/uploads/agent-tasks`,
    /**
     * 청크 업로드(2026-08-04) — chat.openmake.cc 외부 경로는 Cloudflare 무료 플랜의
     * 요청당 100MB 상한이 있어 단일 multipart/json 으로는 대용량 첨부가 edge 413 으로
     * 거절된다. 파일을 청크로 나눠 /api/agent-task-uploads 로 올린 뒤 uploadId 참조로
     * 작업을 생성하면 요청당 크기가 CHUNK_MAX_BYTES 이하로 유지돼 상한을 우회한다.
     */
    /** 청크 1개 최대 크기(bytes) — Cloudflare 100MB 상한 대비 충분한 여유.
     *  AGENT_TASK_CHUNK_MAX_BYTES(기본 32MB). */
    CHUNK_MAX_BYTES: parseInt(process.env.AGENT_TASK_CHUNK_MAX_BYTES || '', 10) || 32 * 1024 * 1024,
    /** 업로드당 청크 수 상한 — REQUEST_BODY_MAX_BYTES(1000MB)/최소 실용 청크 기준 여유값. */
    CHUNK_MAX_COUNT: parseInt(process.env.AGENT_TASK_CHUNK_MAX_COUNT || '', 10) || 256,
    /** ask_human(HITL) 답변 텍스트 최대 길이(문자). AGENT_TASK_HITL_ANSWER_MAX_CHARS(기본 4000). */
    HITL_ANSWER_MAX_CHARS: parseInt(process.env.AGENT_TASK_HITL_ANSWER_MAX_CHARS || '', 10) || 4000,
    /** 미완성(미클레임) 청크 업로드 보관 시한(ms) — init 시 지난 것을 기회적으로 청소.
     *  AGENT_TASK_CHUNK_TTL_MS(기본 24h). */
    CHUNK_UPLOAD_TTL_MS: parseInt(process.env.AGENT_TASK_CHUNK_TTL_MS || '', 10) || 24 * 60 * 60 * 1000,
    /** 종료(completed/failed/cancelled) 후 업로드 원본 보존 기간(ms) — 지나면 보존 스윕이
     *  디스크 원본만 회수한다. DB 메타(input_files 추출텍스트·input_images base64)는 유지되므로
     *  이후 재시도는 추출텍스트로 degrade 될 뿐 실패하지 않는다(task-inputs 의 복사 실패 내성).
     *  AGENT_TASK_UPLOAD_RETENTION_DAYS(기본 30, 0 = 원본 회수 비활성 — tmp/청크 청소는 계속). */
    UPLOAD_RETENTION_MS: ((d) => (Number.isFinite(d) && d >= 0 ? d : 30) * 24 * 60 * 60 * 1000)(
        parseInt(process.env.AGENT_TASK_UPLOAD_RETENTION_DAYS || '', 10)),
    /** 사용자 지정 max_turns 의 절대 상한(Zod 입력 검증 상한도 이 값을 참조).
     *  20 은 조사→데이터 생성→렌더→검증이 이어지는 작업엔 부족하다 — 2026-08-09 실측: 예약
     *  리포트 최근 5회가 **전부 20/20 을 소진**했고, 성공한 회차조차 마진이 0이라 조금만 흔들리면
     *  실패했다. 천장만 올리는 것이라 요청 maxTurns 가 작은 작업(기본 10)에는 영향이 없다.
     *  ⚠️ 턴을 늘려도 MAX_TOTAL_TOKENS(1M)·TOKEN_SOFT_RATIO 가 먼저 걸릴 수 있다 — 토큰 사유로
     *  마무리 턴에 들어가면 shouldAdoptFinalTurnAnswer 가 본문을 살린다.
     *  AGENT_TASK_MAX_TURNS_CEILING 로 오버라이드. */
    MAX_TURNS_CEILING: parseInt(process.env.AGENT_TASK_MAX_TURNS_CEILING || '', 10) || 32,
    /**
     * 작업 목표(goal) 최대 길이. 종전 2,000자는 스키마에 하드코딩돼 있었고 근거가 없었다 —
     * 채팅 message 는 100,000자, tool arguments 는 200,000자를 받는데 goal 만 50배 좁았다.
     * 설계 문서를 그대로 작업 지시로 넣는 사용(2026-08-02, 약 11,000자)이 막혔고,
     * 채팅→작업 자동 위임 경로에서는 긴 메시지가 그대로 goal 이 되므로 같은 실패가 난다.
     * goal 은 매 턴 시스템 프롬프트에 실리므로 무제한은 곤란하다 — 20,000자면 약 1만 토큰,
     * 262K 컨텍스트의 4% 수준이라 안전하다.
     */
    GOAL_MAX_CHARS: parseInt(process.env.AGENT_TASK_GOAL_MAX_CHARS || '', 10) || 20000,
    /** 기본 최대 턴 수(요청이 maxTurns 를 명시하지 않았을 때).
     *  종전 10 은 근거 없이 낮았다 — 2026-08-19 실측: 기본값으로 실행된 141건 중 25건이 10/10 을
     *  소진해 실패했고, 그중엔 조사·검증을 다 끝내고 산출물 저장 직전에 턴이 끊긴 건도 있었다
     *  (6ad7b822: 검색 8회·fact_check 3회 성공 후 data.json 을 쓰지 못하고 goal_incomplete).
     *  반면 천장(32)을 지정한 12건은 상한 도달이 0건(최대 28턴)이라 32 는 사실상 여유가 있다.
     *  턴 상한은 "여기까지만 돌린다"는 안전판이지 예산이 아니다 — 작업이 일찍 끝나면 남는 턴은
     *  소모되지 않으므로, 상향의 비용은 실패·루프 작업이 더 오래 도는 경우로 한정된다. 그 경우도
     *  MAX_TOTAL_TOKENS·TOKEN_SOFT_RATIO 가 별도로 먼저 걸린다.
     *  AGENT_TASK_DEFAULT_MAX_TURNS 로 오버라이드(상한은 MAX_TURNS_CEILING). */
    DEFAULT_MAX_TURNS: parseInt(process.env.AGENT_TASK_DEFAULT_MAX_TURNS || '', 10) || 32,
    /**
     * 대형 첨부(생성 시점 추출 상한 초과 — 샌드박스에서 에이전트가 직접 파싱/OCR) 시 기본 턴 수.
     * 종전 기본 10턴은 수백 페이지 문서의 읽기+정리에 부족해 goal_incomplete 로 실패했다
     * (2026-08-08 실측: 66MB 스캔 PDF 가 턴 10/10 소진, 57MB 도 10/10 턱걸이 완주).
     * 명시 maxTurns 가 오면 그 값이 우선.
     * ⚠️ DEFAULT_MAX_TURNS 상향(10→32, 2026-08-19)으로 이 값이 기본보다 작아졌다. 이 상수는
     * "상향"이 목적이므로 resolveDefaultMaxTurns 가 Math.max 로 역전을 막는다 — 실효를 가지려면
     * 기본값보다 크게 잡을 것.
     */
    LARGE_INPUT_MAX_TURNS: parseInt(process.env.AGENT_TASK_LARGE_INPUT_MAX_TURNS || '', 10) || 20,
    /** 관리자 전체 조회(/admin/conversations 작업 탭, ?viewAll=true) 기본 목록 상한.
     *  AGENT_TASK_LIST_ALL_DEFAULT 로 오버라이드(기본 200). */
    LIST_ALL_DEFAULT: parseInt(process.env.AGENT_TASK_LIST_ALL_DEFAULT || '', 10) || 200,
    /** 작업 전체 타임아웃 (ms) — AGENT_TASK_TIMEOUT_MS 환경변수로 오버라이드.
     *  기본 10분: HTML/디자인 등 장문 deliverable 생성은 단일 LLM 호출이 수 분 걸릴 수 있음. */
    TOTAL_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_TIMEOUT_MS || '', 10) || 10 * 60 * 1000,
    /** 턴당 시간 예산(ms) — 실효 총 타임아웃은 max(TOTAL_TIMEOUT_MS, turnCeiling × 이 값).
     *  근거(2026-09-09 실측 10770ab5): 로컬 qwen3.8-27b 는 턴당 20~30초라 32턴 작업은 13분 이상인데
     *  총 예산이 10분 고정이라, 턴 상한엔 못 미친 채 시간 예산이 먼저 소진돼 마무리 턴 중간에
     *  잘렸다. 턴 상한과 시간 예산을 정합시킨다. AGENT_TASK_TURN_TIME_BUDGET_MS 로 오버라이드(기본 30초). */
    TURN_TIME_BUDGET_MS: parseInt(process.env.AGENT_TASK_TURN_TIME_BUDGET_MS || '', 10) || 30_000,
    /** 마무리 턴 최소 보장 시간(ms) — 잔여 예산이 이보다 적어도 마무리 턴의 LLM 호출만은 이 시간을
     *  준다. 마무리 턴은 도구 없이 장문(보고서)을 생성하는 턴이라 10 tok/s 로 수천 토큰이면 수 분이
     *  걸리는데, 잔여 예산 2분으로 끊기면 산출물이 0 이 된다(위 실측: 2회 실행 모두 같은 지점 실패).
     *  AGENT_TASK_FINAL_TURN_MIN_MS 로 오버라이드(기본 5분). */
    FINAL_TURN_MIN_MS: parseInt(process.env.AGENT_TASK_FINAL_TURN_MIN_MS || '', 10) || 5 * 60 * 1000,
    /** 누적 토큰 상한 (input + output) — runaway 토큰 폭주 방지. AGENT_MAX_TOTAL_TOKENS 로 오버라이드.
     *  멀티턴 도구 작업은 매 턴 prompt_tokens(전체 컨텍스트)를 누적 카운트하므로 200k 는
     *  3턴 만에 소진됐다(샌드박스 도구 작업이 terminate 전에 실패). 기본 1M 으로 상향. */
    MAX_TOTAL_TOKENS: parseInt(process.env.AGENT_MAX_TOTAL_TOKENS || '', 10) || 1_000_000,
    /** 턴 LLM 호출의 일시적 오류(5xx·408·429·connection/timeout) 재시도 횟수 — 후향 실측
     *  (2026-08-05, failed 20건 중 6~7건이 timeout/connection 류)에 근거한 노드 retry 정책 1단계.
     *  0 이면 비활성. 사용자 취소·예산 소진(signal abort)은 재시도하지 않는다.
     *  AGENT_TASK_TURN_RETRY_MAX 로 오버라이드(기본 2). */
    TURN_RETRY_MAX: parseInt(process.env.AGENT_TASK_TURN_RETRY_MAX || '2', 10),
    /** 도구 턴의 모델 호출 한 번의 상한(ms). 넘으면 끊고 다시 시도한다. 0 이면 끔(남은 총 예산만 적용).
     *  종전에는 호출 상한이 "남은 총 예산"뿐이라 멈춘 호출 하나가 16~20분을 태운 뒤 재시도 없이 실패했다.
     *  기본 5분의 근거(2026-10-04 로컬 실측, agent_turn 207건): p50 5초 · p95 12초 · p99 21초 · 최대 221초(4,341토큰 출력).
     *  마무리 턴에는 적용하지 않는다(장문 생성 — FINAL_TURN_MIN_MS 가 따로 보장). AGENT_TASK_TURN_CALL_TIMEOUT_MS */
    TURN_CALL_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_TURN_CALL_TIMEOUT_MS || '', 10) >= 0
        ? parseInt(process.env.AGENT_TASK_TURN_CALL_TIMEOUT_MS as string, 10) : 5 * 60 * 1000,
    /** 도구 턴 모델 호출의 무응답 감시(ms) — 청크 사이 간격이 이 값을 넘으면 호출을 끊고 일시적 오류처럼 다시 시도한다. 0 이면 끔(종전처럼 비스트림).
     *  켜면 도구 턴도 스트리밍으로 부른다(내부 모델만). 근거(2026-10-05 05:00 실측): 모델 서버는 정상 완료했는데 응답이 네트워크에서 유실돼
     *  호출 상한 5분을 다 채운 뒤에야 재시도했다. 상한을 줄이면 정상적인 긴 생성(최대 221초)이 끊기므로 "진행 여부"로 판별한다.
     *  감시가 걸린 호출에는 호출 상한(TURN_CALL_TIMEOUT_MS)을 적용하지 않는다 — 청크가 오는 긴 생성을 끊지 않게.
     *  실측(2026-10-05, qwen3.8-27b): 5,145토큰 도구 인자 생성 290초 동안 청크 간격은 4초 미만이었다.
     *  AGENT_TASK_TURN_STREAM_IDLE_MS (기본 60초) */
    TURN_STREAM_IDLE_MS: parseInt(process.env.AGENT_TASK_TURN_STREAM_IDLE_MS || '', 10) >= 0
        ? parseInt(process.env.AGENT_TASK_TURN_STREAM_IDLE_MS as string, 10) : 60_000,
    /** 무응답 감시의 첫 청크 기한(ms) — 첫 청크 전에는 모델 서버 대기열·프롬프트 처리 시간이 들어 청크 간격보다 길게 둔다.
     *  AGENT_TASK_TURN_STREAM_FIRST_CHUNK_MS (기본 120초) */
    TURN_STREAM_FIRST_CHUNK_MS: parseInt(process.env.AGENT_TASK_TURN_STREAM_FIRST_CHUNK_MS || '', 10) || 120_000,
    /** 호출 상한에 걸린 호출을 다시 시도하는 횟수(정상적으로 긴 생성이 되풀이되지 않게 작게 둔다). AGENT_TASK_TURN_CALL_TIMEOUT_RETRY_MAX */
    TURN_CALL_TIMEOUT_RETRY_MAX: parseInt(process.env.AGENT_TASK_TURN_CALL_TIMEOUT_RETRY_MAX || '1', 10),
    /** 빈 응답(본문·도구 호출 없음)을 되묻는 횟수. 넘으면 종전대로 완료 관문으로 보낸다. AGENT_TASK_EMPTY_RESPONSE_MAX_RETRIES */
    EMPTY_RESPONSE_MAX_RETRIES: parseInt(process.env.AGENT_TASK_EMPTY_RESPONSE_MAX_RETRIES || '2', 10),
    /** 턴 재시도 지수 백오프 기저(ms) — n번째 재시도 전 기저 × 2^(n-1) 대기(abort 시 즉시 중단).
     *  AGENT_TASK_TURN_RETRY_BACKOFF_MS 로 오버라이드(기본 2초). */
    TURN_RETRY_BACKOFF_MS: parseInt(process.env.AGENT_TASK_TURN_RETRY_BACKOFF_MS || '', 10) || 2_000,
    /** 플랜 자동 진행(088 증분 3) — 단계 완료/차단 후 in_progress 가 없으면 첫 not_started 를
     *  결정적으로 승격. 모델이 [~] 마킹을 생략해도(후향 60%, 명시 지시에도 라이브 재현)
     *  스텝→노드 귀속(plan_step_index)·진행 표시가 비지 않게 한다. 모델의 명시 마킹이 우선.
     *  AGENT_TASK_PLAN_AUTO_ADVANCE=false 로 비활성(기본 on). */
    PLAN_AUTO_ADVANCE: process.env.AGENT_TASK_PLAN_AUTO_ADVANCE !== 'false',
    /** goal 의 번호 절차(`[절차] 1) … 7)`)를 작업 시작 시 초기 계획으로 심는다.
     *  근거: 모델은 goal 의 번호를 계획으로 인식해 plan_create 없이 plan_update(step:N) 부터
     *  부른다 — 실측(2026-08-28) plan 프로토콜 오류 28건 중 20건이 이 형태. 실패 인자가
     *  `{step,status}` 뿐이라 빈 계획을 만들어줘도 그 단계가 무엇인지 알 수 없어, goal 의
     *  번호를 그대로 심어 번호 체계를 일치시킨다. 결정적 파싱(LLM 없음).
     *  AGENT_TASK_PLAN_FROM_GOAL=false 로 비활성(기본 on — 절차가 없는 goal 엔 no-op). */
    PLAN_FROM_GOAL: process.env.AGENT_TASK_PLAN_FROM_GOAL !== 'false',
    /** 번호 항목이 이 수 미만이면 절차 목록이 아니라고 보고 심지 않는다(오탐 방지). */
    PLAN_FROM_GOAL_MIN_ITEMS: parseInt(process.env.AGENT_TASK_PLAN_FROM_GOAL_MIN_ITEMS || '3', 10),
    /** 초기 계획으로 심을 최대 단계 수. */
    PLAN_FROM_GOAL_MAX_ITEMS: parseInt(process.env.AGENT_TASK_PLAN_FROM_GOAL_MAX_ITEMS || '20', 10),
    /** 단계 텍스트 상한(초과분은 잘라냄) — goal 의 한 항목이 길어도 계획 표시가 무너지지 않게. */
    PLAN_FROM_GOAL_MAX_TEXT_CHARS: parseInt(process.env.AGENT_TASK_PLAN_FROM_GOAL_MAX_TEXT_CHARS || '160', 10),
    /** HITL 무응답 강등 — 승인 무응답(timeout, 명시 거절 아님)이 이 횟수에 달하면 이후 턴에서
     *  승인 필요 도구(+ask_human)를 제거하고 확보한 정보로 마무리를 유도한다. 후향 실측: 방치
     *  task 가 승인 대기(30분)×N 반복으로 예산만 소진하고 산출물 0 으로 종결되던 패턴 차단.
     *  0 이면 비활성. AGENT_TASK_HITL_TIMEOUT_DEGRADE_AFTER 로 오버라이드(기본 2). */
    HITL_TIMEOUT_DEGRADE_AFTER: parseInt(process.env.AGENT_TASK_HITL_TIMEOUT_DEGRADE_AFTER || '2', 10),
    /** 주차(F16.7)된 ask_human·mcp_elicit 승인의 최대 대기(ms) — 이후 종전처럼 만료. AGENT_TASK_HITL_PARK_MAX_MS(기본 7일).
     *  켜는 플래그는 system_settings `AGENT_TASK_HITL_PARK_ON_TIMEOUT`(getConfig().agentTaskHitlParkOnTimeout). */
    HITL_PARK_MAX_MS: parseInt(process.env.AGENT_TASK_HITL_PARK_MAX_MS || '', 10) || 7 * 24 * 60 * 60 * 1000,
    /** 주차 스윕 주기(ms) — 결정이 왔는데 재개되지 못한 작업(로컬 디바이스 미연결 등) 재시도·상한 초과 정리·workspace 유지. AGENT_TASK_HITL_PARK_SWEEP_MS(기본 10분) */
    HITL_PARK_SWEEP_MS: parseInt(process.env.AGENT_TASK_HITL_PARK_SWEEP_MS || '', 10) || 10 * 60 * 1000,
    /** 주차 만료 점검 주기(ms) — 상한(기기 대기·넘겨받기·질문 응답 대기)을 넘긴 주차 작업만 실패로 바꾸는 가벼운 점검(조회 1회).
     *  재개 시도·workspace 유지는 위 스윕 주기 그대로. 상한 초과 → 실패 표시의 최대 지연이 이 값이다. AGENT_TASK_HITL_PARK_EXPIRE_SWEEP_MS(기본 1분) */
    HITL_PARK_EXPIRE_SWEEP_MS: parseInt(process.env.AGENT_TASK_HITL_PARK_EXPIRE_SWEEP_MS || '', 10) || 60 * 1000,
    /** 승인 대기 유예(ms) — 이 시간을 넘긴 승인 대기는 도구 종류와 무관하게 주차해 실행 슬롯을 반납한다(한 사용자의
     *  늦은 승인이 다른 사용자의 작업을 막지 않게). 서브에이전트 승인은 재개 지점이 없어 제외. 0 이면 비활성(종전 동작).
     *  AGENT_TASK_HITL_PARK_GRACE_MS(기본 0, 권장 60000) */
    HITL_PARK_GRACE_MS: parseInt(process.env.AGENT_TASK_HITL_PARK_GRACE_MS || '0', 10) || 0,
    /**
     * 마무리 턴 강제(2026-08-03) — 자원 상한에 **닿기 전에** 도구를 끊고 종합 답변을 받는다.
     *
     * 하드 상한(MAX_TOTAL_TOKENS·max_turns)은 폭주를 끊을 뿐 산출을 남기지 못한다. 30일 실측:
     * 예약 리포트 20/20 턴 3건 중 2건이 리포트 파일을 이미 만든 뒤 검증 사족("Let me verify
     * the file exists")에서 절단됐고, 마지막 응답이 35~96자라 결과로 쓸 수 없었다.
     * 남은 턴이 1 이거나 누적 토큰이 하드 상한의 SOFT_RATIO 에 닿으면 도구를 제거하고
     * 마무리 지시(getAgentTaskFinalTurnNudge)를 1회 주입해 정상 완료 경로로 유도한다.
     *
     * 하드 상한 자체는 낮추지 않는다 — 완료 작업 p95 가 538K, 최대 618K 로 1M 은 정상 작업을
     * 죽이지 않는 안전망이며, 실제 제어는 이 소프트 경계가 맡는다.
     * AGENT_TASK_FINAL_TURN_NUDGE=false 로 비활성.
     */
    FINAL_TURN_NUDGE_ENABLED: process.env.AGENT_TASK_FINAL_TURN_NUDGE !== 'false',
    /**
     * 마무리 턴 전환 토큰 비율 (MAX_TOTAL_TOKENS 대비). AGENT_TASK_TOKEN_SOFT_RATIO 로 오버라이드.
     *
     * 0.7 인 이유는 **마무리 턴 한 번이 하드 상한 안에 반드시 들어오게** 하기 위해서다.
     * 남는 여유가 300K 로 모델 컨텍스트(262K)보다 크므로, 마무리 턴이 전체 컨텍스트를 다시
     * 실어도 하드 상한에 걸려 죽지 않는다. 0.8(여유 200K)이면 컨텍스트가 큰 작업의 마무리 턴이
     * 상한을 넘겨, 정리시키려던 턴에서 오히려 산출 없이 종료될 수 있다.
     * 완료 작업 실측(30일) p95 538K·최대 618K 가 700K 아래라 정상 작업은 이 경계에 닿지 않는다.
     */
    TOKEN_SOFT_RATIO: parseFloat(process.env.AGENT_TASK_TOKEN_SOFT_RATIO || '') || 0.7,
    /** 검색류 도구 호출 횟수 하드 상한 — 초과 시 다음 턴부터 검색 도구를 제거해 강제 종합.
     *  AGENT_MAX_SEARCH_CALLS 환경변수로 오버라이드 가능 (기본 5). */
    MAX_SEARCH_CALLS: parseInt(process.env.AGENT_MAX_SEARCH_CALLS || '5', 10),
    /** 검색/정보수집 도구 식별 키워드 (tool name 에 포함되면 검색류로 카운트) */
    SEARCH_TOOL_KEYWORDS: ['search', 'visit_page', 'research', 'firecrawl', 'scrape', 'crawl', 'fetch'] as readonly string[],
    /** 샌드박스 browser 도구 호출 횟수 하드 상한 — browser 는 SEARCH_TOOL_KEYWORDS 에 안 잡혀
     *  검색 throttle 로 제어되지 않으므로 별도 cap. 초과 시 다음 턴부터 browser 도구를 제거해
     *  강제 종합. 탐색·추출이 여러 호출로 나뉘므로 검색보다 넉넉히(기본 10).
     *  AGENT_MAX_BROWSER_CALLS 로 오버라이드. */
    MAX_BROWSER_CALLS: parseInt(process.env.AGENT_MAX_BROWSER_CALLS || '10', 10),
    /** stuck 감지 — 동일 assistant 응답이 이 횟수만큼 연속되면 전략변경 프롬프트 주입(무한루프 방지).
     *  OpenManus BaseAgent.is_stuck 패턴. AGENT_STUCK_THRESHOLD 로 오버라이드(기본 3). */
    STUCK_THRESHOLD: parseInt(process.env.AGENT_STUCK_THRESHOLD || '3', 10),
    /** 도구 호출 반복 가드(tool-loop-guard) — 같은 이름·인자의 호출이 연속 실패하거나 같은 결과만 돌려줄 때 안내·차단한다.
     *  AGENT_TASK_TOOL_LOOP_GUARD=false 로 끈다. 임계값은 실측이 아니다 — 로컬 기록(도구 결과 44건)에 반복 사례가 없어
     *  참고값(경고 2·차단 5)을 한 단계 보수적으로 잡았다. 발동은 결과 문구로 스텝에 남으니 운영 집계 뒤 조정한다. */
    TOOL_LOOP_GUARD_ENABLED: process.env.AGENT_TASK_TOOL_LOOP_GUARD !== 'false',
    /** 같은 호출 연속 실패: 이 횟수부터 안내 / 이 횟수를 넘겨 다시 부르면 실행하지 않음. */
    TOOL_LOOP_WARN_FAILURES: parseInt(process.env.AGENT_TASK_TOOL_LOOP_WARN_FAILURES || '2', 10),
    TOOL_LOOP_BLOCK_FAILURES: parseInt(process.env.AGENT_TASK_TOOL_LOOP_BLOCK_FAILURES || '4', 10),
    /** 읽기 호출의 같은 결과 연속: 이 횟수부터 안내 / 이 횟수를 넘겨 다시 부르면 실행하지 않음. */
    TOOL_LOOP_WARN_SAME_RESULT: parseInt(process.env.AGENT_TASK_TOOL_LOOP_WARN_SAME_RESULT || '3', 10),
    TOOL_LOOP_BLOCK_SAME_RESULT: parseInt(process.env.AGENT_TASK_TOOL_LOOP_BLOCK_SAME_RESULT || '5', 10),
    /** 목표 달성 judge — 아티팩트 없는 최종 답변 완료 시 판정 전용 LLM 1회 호출로 목표 달성
     *  여부를 검증(마커 미준수 보완). 미달성 판정 시 completed 대신 failed(goal_incomplete).
     *  판정 실패/파싱 불가는 fail-open(완료 유지). AGENT_TASK_GOAL_JUDGE=false 로 비활성. */
    GOAL_JUDGE_ENABLED: process.env.AGENT_TASK_GOAL_JUDGE !== 'false',
    /** judge 셰도우 계측 — 아티팩트가 **있는** 완료에서도 판정을 돌리되 **적용하지 않고 기록만**
     *  한다(step_type='judge_shadow'). 발동 조건 확대의 게이트인 오판율을 재려면 표본이 필요한데,
     *  현행 조건(아티팩트 0)으로는 completed 의 18% 만 판정을 거쳐 표본이 쌓이지 않는다
     *  (2026-08-27 실측 30일: completed 120건 중 achieved 22 · skipped 43 · 미판정 55).
     *  완료 흐름은 불변이며 실패해도 fail-open. AGENT_TASK_GOAL_JUDGE_SHADOW=false 로 비활성. */
    GOAL_JUDGE_SHADOW_ENABLED: process.env.AGENT_TASK_GOAL_JUDGE_SHADOW !== 'false',
    /** judge 에 넘기는 최종 답변 최대 글자 수 (프롬프트 팽창 방지) */
    GOAL_JUDGE_MAX_ANSWER_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_MAX_CHARS || '6000', 10),
    /** judge 실행 컨텍스트에 싣는 최근 도구 결과 수 — 성공 증거 부재로 완수 작업을 미달성
     *  판정하던 false negative(2026-08-09 예약리포트·2026-08-15 로컬실행, 실측 2회) 완화. */
    GOAL_JUDGE_EVIDENCE_MAX_ITEMS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_EVIDENCE_MAX_ITEMS || '8', 10),
    /** judge 도구 결과 항목당 글자 캡 (프롬프트 팽창 방지) */
    GOAL_JUDGE_EVIDENCE_ITEM_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_EVIDENCE_ITEM_CHARS || '320', 10),
    /** judge 사유 스텝에 남길 reason 최대 글자 (파싱 실패 시 raw 응답 앞부분도 같이 남긴다) */
    GOAL_JUDGE_REASON_MAX_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_REASON_MAX_CHARS || '600', 10),
    GOAL_JUDGE_RAW_KEEP_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_RAW_KEEP_CHARS || '400', 10),
    /** judge 에 싣는 제출 산출물(아티팩트) 최대 개수 — 셰도우 확대(2026-08-27)로 아티팩트가 있는
     *  완료도 판정하게 되면서 필요해졌다. 종전엔 발동 조건이 아티팩트 0 이라 실을 것이 없었다. */
    GOAL_JUDGE_ARTIFACT_MAX_ITEMS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_ARTIFACT_MAX_ITEMS || '5', 10),
    /** 산출물 항목당 본문 글자 캡 (프롬프트 팽창 방지 — 목표 수행 여부 판단엔 앞부분으로 충분) */
    GOAL_JUDGE_ARTIFACT_ITEM_CHARS: parseInt(process.env.AGENT_TASK_GOAL_JUDGE_ARTIFACT_ITEM_CHARS || '400', 10),
    /** judge 에 싣는 "사용자가 거절한 동작" 최대 건수 — 거절 기록으로 판정 입력이 불어나지 않게(2026-10-09). */
    GOAL_JUDGE_REJECTION_MAX_ITEMS: 10,
    /** 거절 항목당 인자 요약(JSON) 글자 캡 */
    GOAL_JUDGE_REJECTION_ARGS_CHARS: 200,
    /** 거절 항목당 거절 사유 글자 캡 */
    GOAL_JUDGE_REJECTION_REASON_CHARS: 300,
    /** 부팅 자동 복구 — 프로세스 재시작으로 중단된 task 를 부팅 시 자동 resume 한다.
     *  주의: schema-initializer 가 부팅 시 running/paused 를 failed('server restarted') 로 먼저
     *  마킹하므로, 복구 대상은 ①잔존 running/paused(마킹 실패 대비) + ②restart 마킹 + checkpoint
     *  보유 + 최근 window 내 task. checkpoint 없으면 failed 유지(기존 수동 UX 그대로).
     *  AGENT_TASK_BOOT_RECOVERY=false 로 비활성(기본 on). */
    BOOT_RECOVERY_ENABLED: process.env.AGENT_TASK_BOOT_RECOVERY !== 'false',
    /** 실행 소유권(lease, 176) — 실행 중인 작업은 소유권을 주기적으로 연장하고, 소유권이 지난 작업은 주기 점검이 가져가
     *  이어서 실행한다(서버가 죽어도 다른 서버·같은 서버가 복구). AGENT_TASK_LEASE_ENABLED=false 로 끈다(종전: 부팅 때만 복구). */
    LEASE_ENABLED: process.env.AGENT_TASK_LEASE_ENABLED !== 'false',
    /** 소유권 길이(ms) — 이 시간 동안 연장이 없으면 죽은 것으로 본다. 연장 주기는 1/3. AGENT_TASK_LEASE_MS(기본 60초) */
    LEASE_MS: parseInt(process.env.AGENT_TASK_LEASE_MS || '', 10) || 60_000,
    /** 지난 소유권 점검 주기(ms). AGENT_TASK_LEASE_SWEEP_MS(기본 30초) */
    LEASE_SWEEP_MS: parseInt(process.env.AGENT_TASK_LEASE_SWEEP_MS || '', 10) || 30_000,
    /** 마지막 진행 시각(191, R8)을 메모리에서 DB 로 쓰는 주기(ms). AGENT_TASK_PROGRESS_FLUSH_MS(기본 20초) */
    PROGRESS_FLUSH_MS: parseInt(process.env.AGENT_TASK_PROGRESS_FLUSH_MS || '', 10) || 20_000,
    /** watchdog(R8·R9) — 진행 멈춤·대기열 적체·모델 대기 장기화를 게이지·알림으로 드러낸다(작업 상태는 바꾸지 않는다). AGENT_TASK_WATCHDOG_ENABLED=false 로 끈다 */
    WATCHDOG_ENABLED: process.env.AGENT_TASK_WATCHDOG_ENABLED !== 'false',
    /** watchdog 점검 주기(ms). AGENT_TASK_WATCHDOG_MS(기본 60초) */
    WATCHDOG_MS: parseInt(process.env.AGENT_TASK_WATCHDOG_MS || '', 10) || 60_000,
    /** 실행 중인데 진행이 이만큼 없으면 멈춘 것으로 본다(ms). AGENT_TASK_STALE_MS(기본 15분) */
    STALE_MS: parseInt(process.env.AGENT_TASK_STALE_MS || '', 10) || 900_000,
    /** 대기열 적체 알림 — 대기 건수 기준. AGENT_TASK_QUEUE_BACKLOG_PENDING(기본 20) */
    QUEUE_BACKLOG_PENDING: parseInt(process.env.AGENT_TASK_QUEUE_BACKLOG_PENDING || '', 10) || 20,
    /** 대기열 적체 알림 — 가장 오래 기다린 시간 기준(ms). AGENT_TASK_QUEUE_BACKLOG_WAIT_MS(기본 5분) */
    QUEUE_BACKLOG_WAIT_MS: parseInt(process.env.AGENT_TASK_QUEUE_BACKLOG_WAIT_MS || '', 10) || 300_000,
    /** 모델 대기 장기화 알림 기준(ms). AGENT_TASK_MODEL_WAIT_ALERT_MS(기본 30분) */
    MODEL_WAIT_ALERT_MS: parseInt(process.env.AGENT_TASK_MODEL_WAIT_ALERT_MS || '', 10) || 1_800_000,
    /** 부팅 복구 인정 window(ms) — '이번 재시작'으로 마킹된 task 만 자동 resume 하고, 과거
     *  재시작이 남긴 오래된 failed('server restarted') 는 건드리지 않는다(수동 resume 대상).
     *  AGENT_TASK_BOOT_RECOVERY_WINDOW_MS 로 오버라이드(기본 15분). */
    BOOT_RECOVERY_WINDOW_MS: parseInt(process.env.AGENT_TASK_BOOT_RECOVERY_WINDOW_MS || '', 10) || 15 * 60_000,
    /** 진행 없이 되풀이되는 자동 복구 상한 — 한 작업이 새 턴 체크포인트 없이 이만큼 복구(부팅 복구·지난 소유권 점검)됐으면
     *  더 재개하지 않고 failed(recovery_limit)로 둔다(체크포인트는 남아 수동 이어하기 가능). 작업 하나가 프로세스를 죽일 때
     *  재시작 → 자동 재개 → 다시 죽음이 끝없이 도는 것을 끊는다. 0 이면 끔. AGENT_TASK_RECOVERY_MAX_ATTEMPTS(기본 3) */
    RECOVERY_MAX_ATTEMPTS: parseInt(process.env.AGENT_TASK_RECOVERY_MAX_ATTEMPTS || '3', 10),
    /** 동적 도구 서브셋팅(Phase 2-A) — 샌드박스 활성 시 목표 관련성 top-K MCP 도구를 예산 내에서
     *  샌드박스 도구에 합류(호스트 실행 + HITL 승인 게이트). 전체 카탈로그(~150)를 넘기면 vLLM
     *  문법 컴파일이 폭주하므로 예산으로 캡한다. ⚠️ 기본 OFF — 활성화 전 문법 컴파일 지연 실측 필수.
     *  AGENT_TASK_DYNAMIC_TOOLS=true 로 활성. */
    DYNAMIC_TOOLS_ENABLED: process.env.AGENT_TASK_DYNAMIC_TOOLS === 'true',
    /** 동적 도구 포함 시 LLM 에 노출하는 총 도구 수 상한(샌드박스+extra+동적). 보수적 기본(30) —
     *  실측 후 상향. AGENT_TASK_DYNAMIC_TOOLS_BUDGET 로 오버라이드. */
    DYNAMIC_TOOLS_BUDGET: parseInt(process.env.AGENT_TASK_DYNAMIC_TOOLS_BUDGET || '30', 10),
    /** 도구 결과 데이터 래퍼 — 호스트·외부 도구(검색·MCP)와 browser 결과를 <tool_output> 으로 감싸고 뒤에 작업 목표를
     *  다시 적는다(간접 프롬프트 주입 완화, Meta-SecAlign 2507.02735 의 학습 없는 방어). 대화에 싣는 내용만 바뀌고 스텝 기록은 원문.
     *  기본 OFF — 도구 결과마다 토큰이 늘므로 레드팀 평가(evaluation/redteam)로 효과를 잰 뒤 켠다. AGENT_TASK_TOOL_RESULT_WRAP_ENABLED=true. */
    TOOL_RESULT_WRAP_ENABLED: process.env.AGENT_TASK_TOOL_RESULT_WRAP_ENABLED === 'true',
    /** 래퍼 뒤에 다시 적는 작업 목표의 최대 글자 수. AGENT_TASK_TOOL_RESULT_WRAP_GOAL_MAX_CHARS */
    TOOL_RESULT_WRAP_GOAL_MAX_CHARS: parseInt(process.env.AGENT_TASK_TOOL_RESULT_WRAP_GOAL_MAX_CHARS || '300', 10),
    /** 산출물 실행 검증(Phase 2-B) — 샌드박스 활성 시 코드 deliverable 을 완료 전 문법/컴파일
     *  검사(py_compile·node --check, 코드 미실행). 실패 시 오류 리포트를 주입해 1회 자가수정 유도.
     *  AGENT_TASK_VERIFY_DELIVERABLE=false 로 비활성(기본 on, 단 샌드박스 활성 시에만 동작). */
    VERIFY_DELIVERABLE_ENABLED: process.env.AGENT_TASK_VERIFY_DELIVERABLE !== 'false',
    /** 산출물 검증 실패 시 자가수정 재시도 최대 횟수 — 초과하면 검증을 건너뛰고 완료(무한루프 방지). */
    VERIFY_DELIVERABLE_MAX_RETRIES: parseInt(process.env.AGENT_TASK_VERIFY_DELIVERABLE_MAX_RETRIES || '1', 10),
    /** workspace 테스트 게이트(2026-09-06) — 완료 관문에서 workspace 에 **이미 있는** 테스트 러너
     *  (package.json scripts.test + node_modules · pytest 설정/tests 디렉토리)를 감지하면 1회 실행해
     *  실패 출력을 주입하고 수정 턴을 준다. 러너가 없으면 아무 것도 하지 않는다(리포트형 작업 무영향).
     *  실행 grounding 이 self-critique 보다 값싸고 정확하다는 같은 원칙(deliverable-verify).
     *  AGENT_TASK_WORKSPACE_TEST_GATE=false 로 비활성. */
    WORKSPACE_TEST_GATE_ENABLED: process.env.AGENT_TASK_WORKSPACE_TEST_GATE !== 'false',
    /** 테스트 실패 시 수정 턴 최대 횟수 — verifyRetries 카운터를 deliverable 검증과 공유한다. */
    WORKSPACE_TEST_MAX_RETRIES: parseInt(process.env.AGENT_TASK_WORKSPACE_TEST_MAX_RETRIES || '2', 10),
    /** fork 작업 공간 복원(agent-task/fork-workspace) — 턴 체크포인트마다 작업 공간을 git ref 로 남기고, 갈라져 나온 작업이
     *  그 시점 파일로 시작한다. 코드 diff 기준점(TASK_SANDBOX code diff)이 켜진 docker 샌드박스에서만 동작한다.
     *  기본 OFF — 턴마다 git 스냅숏 비용이 들고 원 작업 공간이 남아 있을 때만 복원되므로 운영 관찰 후 켠다.
     *  AGENT_TASK_FORK_WORKSPACE_RESTORE_ENABLED=true. */
    FORK_WORKSPACE_RESTORE_ENABLED: process.env.AGENT_TASK_FORK_WORKSPACE_RESTORE_ENABLED === 'true',
    /** 테스트 실패 출력 중 모델에 주입할 최대 글자(끝부분 우선 — 실패 요약은 보통 마지막에 있다). */
    WORKSPACE_TEST_REPORT_MAX_CHARS: parseInt(process.env.AGENT_TASK_WORKSPACE_TEST_REPORT_MAX_CHARS || '3000', 10),
    /** 오래된 도구 결과 접기(2026-09-06) — 매 턴 전체 대화를 재전송하므로 비용이 턴 수에 O(n²)로
     *  붙는다(30일 실측: 완료 작업 평균 43만 토큰, 스텝 본문 총량의 ~18배). 최근 KEEP_TURNS 개
     *  assistant 턴보다 오래된 tool 메시지 중 MIN_CHARS 를 넘는 것을 앞부분 HEAD_CHARS 만 남긴
     *  스텁으로 치환한다(원문은 스텝 DB 에 그대로. 스텁은 다시 읽지 말라고 안내한다 — context-fold.ts 의 반복 읽기 사고 기록).
     *  AGENT_TASK_CONTEXT_FOLD=false 로 비활성. */
    CONTEXT_FOLD_ENABLED: process.env.AGENT_TASK_CONTEXT_FOLD !== 'false',
    CONTEXT_FOLD_KEEP_TURNS: parseInt(process.env.AGENT_TASK_CONTEXT_FOLD_KEEP_TURNS || '4', 10),
    CONTEXT_FOLD_MIN_CHARS: parseInt(process.env.AGENT_TASK_CONTEXT_FOLD_MIN_CHARS || '1500', 10),
    CONTEXT_FOLD_HEAD_CHARS: parseInt(process.env.AGENT_TASK_CONTEXT_FOLD_HEAD_CHARS || '240', 10),
    /** 마무리 턴 본문 채택 임계(글자) — 자원 상한으로 도구를 막은 턴에서 모델이 도구 호출과 본문을
     *  함께 뱉었을 때, 본문이 이 길이 이상이면 최종 답변으로 채택해 완료 관문으로 보낸다.
     *  (미만이면 종전대로 응답을 버리고 다음 턴/턴상한 종료 — "산출물 다 만들고 실패 기록" 방지와
     *  "의도 선언만 하고 완료 오표시" 방지의 경계. 2026-08-09 예약 리포트 실측: 실패 사례의 의도
     *  선언문은 100자 안팎, 정상 최종 정리는 수백 자.) AGENT_TASK_FINAL_TURN_MIN_ANSWER 로 오버라이드. */
    FINAL_TURN_MIN_ANSWER_CHARS: parseInt(process.env.AGENT_TASK_FINAL_TURN_MIN_ANSWER || '200', 10),
    /** 도구 호출 인자 영속(091) — tool_result 스텝에 마스킹된 args 를 남겨 사후 원인 분석을 연다.
     *  (종전엔 tool_name 만 남아 "어떤 인자로 호출해서 실패했는가"를 복기할 수 없었다.)
     *  AGENT_TASK_TOOL_ARGS_PERSIST=false 로 비활성(기본 on). */
    TOOL_ARGS_PERSIST_ENABLED: process.env.AGENT_TASK_TOOL_ARGS_PERSIST !== 'false',
    /** 영속하는 인자 JSON 의 최대 글자 수 — 초과 시 절단 표식으로 대체(저장 팽창 방지).
     *  파일 내용을 통째로 넘기는 write 계열 인자가 있어 캡이 필요하다. */
    TOOL_ARGS_MAX_CHARS: parseInt(process.env.AGENT_TASK_TOOL_ARGS_MAX_CHARS || '2000', 10),
    /** 동시성 큐(Phase 3-B) — /execute·resume·부팅복구가 즉시 발사 대신 큐에 제출. 전역·유저별
     *  동시 실행 상한을 넘으면 'queued' 로 대기, 슬롯이 비면 dequeue. 기본 OFF(켜면 즉시발사→큐).
     *  ⚠️ 단일 프로세스 전제(API instances:1). 멀티프로세스 확장 시 Redis 백엔드 필요. */
    QUEUE_ENABLED: process.env.AGENT_TASK_QUEUE_ENABLED === 'true',
    /** 전역 동시 실행 상한. AGENT_TASK_QUEUE_GLOBAL_MAX 로 오버라이드(기본 4). */
    QUEUE_GLOBAL_MAX: parseInt(process.env.AGENT_TASK_QUEUE_GLOBAL_MAX || '4', 10),
    /** 유저별 동시 실행 상한. AGENT_TASK_QUEUE_USER_MAX 로 오버라이드(기본 2). */
    QUEUE_USER_MAX: parseInt(process.env.AGENT_TASK_QUEUE_USER_MAX || '2', 10),
    /** 큐 우선순위(F16.6, 131) — 대기열은 높을수록 먼저, 같으면 등록순. 예약 실행은 SCHEDULED, 사용자 실행은 DEFAULT,
     *  관리자만 DEFAULT 초과(상한은 system_settings AGENT_TASK_QUEUE_PRIORITY_MAX). */
    QUEUE_PRIORITY_SCHEDULED: -1,
    QUEUE_PRIORITY_DEFAULT: 0,
    /** 대기 시간 요약(GET /queue/stats 의 memory.wait.recent)에 쓰는 최근 시작 건수 — 대기열에서 꺼내(또는 즉시) 시작한 최근 N건. */
    QUEUE_WAIT_SAMPLE_SIZE: 200,
    /** 실패 큐 뷰(GET /queue/dead) 기본 조회 기간(일)·최대 행 수. AGENT_TASK_DEAD_QUEUE_DAYS / AGENT_TASK_DEAD_QUEUE_LIMIT */
    DEAD_QUEUE_DAYS: parseInt(process.env.AGENT_TASK_DEAD_QUEUE_DAYS || '7', 10),
    DEAD_QUEUE_LIMIT: parseInt(process.env.AGENT_TASK_DEAD_QUEUE_LIMIT || '100', 10),
    /** 스케줄/반복 트리거(Phase 3-A) — cron/interval 로 task 를 반복 실행. 기본 OFF.
     *  AGENT_TASK_SCHEDULES_ENABLED=true 로 활성. 스케줄러 tick 이 due 스케줄을 큐에 제출. */
    SCHEDULES_ENABLED: process.env.AGENT_TASK_SCHEDULES_ENABLED === 'true',
    /** 스케줄러 tick 주기(ms) — due 스케줄 스캔 간격. AGENT_TASK_SCHEDULE_TICK_MS(기본 60초). */
    SCHEDULE_TICK_MS: parseInt(process.env.AGENT_TASK_SCHEDULE_TICK_MS || '', 10) || 60_000,
    /** 유저당 최대 스케줄 수. AGENT_TASK_SCHEDULE_MAX_PER_USER(기본 10). */
    SCHEDULE_MAX_PER_USER: parseInt(process.env.AGENT_TASK_SCHEDULE_MAX_PER_USER || '10', 10),
    /** interval 스케줄 최소 간격(초) — 남용 방지. AGENT_TASK_SCHEDULE_MIN_INTERVAL_SEC(기본 300). */
    SCHEDULE_MIN_INTERVAL_SEC: parseInt(process.env.AGENT_TASK_SCHEDULE_MIN_INTERVAL_SEC || '300', 10),
    /** 연속 실패 이 횟수 도달 시 스케줄 자동 비활성(폭주 차단). AGENT_TASK_SCHEDULE_DISABLE_AFTER_FAILURES(기본 5). */
    SCHEDULE_DISABLE_AFTER_FAILURES: parseInt(process.env.AGENT_TASK_SCHEDULE_DISABLE_AFTER_FAILURES || '5', 10),
    /** 이전 실행이 진행 중 상태로 남았어도 이 시간(ms) 넘게 갱신이 없으면 멈춘 표시로 보고 발화를 막지 않는다.
     *  기본 40분 = 예약 총 예산(20분)의 두 배. AGENT_TASK_SCHEDULE_OVERLAP_STALE_MS */
    SCHEDULE_OVERLAP_STALE_MS: parseInt(process.env.AGENT_TASK_SCHEDULE_OVERLAP_STALE_MS || '', 10) || 40 * 60 * 1000,
    /** 예약 실행 승인정책 — 예약 task 는 무인(사람 승인 불가)이므로 기본 'none'(전부 자동).
     *  전역 TASK_SANDBOX_APPROVAL_POLICY='all' 이면 예약 task 가 첫 도구서 pause 되어 멈추므로 분리한다.
     *  AGENT_TASK_SCHEDULE_APPROVAL_POLICY(기본 'none' | 'high-risk' | 'all'). */
    SCHEDULE_APPROVAL_POLICY: ((): 'all' | 'high-risk' | 'none' => {
        const v = process.env.AGENT_TASK_SCHEDULE_APPROVAL_POLICY;
        return v === 'all' || v === 'high-risk' || v === 'none' ? v : 'none';
    })(),
    /** 예약(무인) task 총 타임아웃(ms) — 리포트·디자인 등 무거운 생성 워크플로우는 대화형 기본
     *  10분을 넘길 수 있어 분리(기본 20분). AGENT_TASK_SCHEDULE_TIMEOUT_MS. */
    SCHEDULE_TOTAL_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_SCHEDULE_TIMEOUT_MS || '', 10) || 20 * 60 * 1000,
    /** 예약 산출물 게시 루트 — 백엔드가 인증 없이 항상 서빙하는 정적 경로(legacy-web public) 하위.
     *  publish_slug 가 설정된 스케줄의 결과물이 <루트>/<slug>/{YYYY-MM-DD,latest}.html 로 쌓인다.
     *  AGENT_TASK_SCHEDULE_PUBLISH_DIR(기본 <cwd>/apps/legacy-web/public/generated/reports). */
    SCHEDULE_PUBLISH_DIR: process.env.AGENT_TASK_SCHEDULE_PUBLISH_DIR
        || `${process.cwd()}/apps/legacy-web/public/generated/reports`,
    /** 게시 URL 접두사 — SCHEDULE_PUBLISH_DIR 이 실제로 서빙되는 경로와 짝을 이룬다.
     *  AGENT_TASK_SCHEDULE_PUBLISH_URL_PREFIX(기본 /generated/reports). */
    SCHEDULE_PUBLISH_URL_PREFIX: process.env.AGENT_TASK_SCHEDULE_PUBLISH_URL_PREFIX || '/generated/reports',
    /** workspace 에서 게시 대상으로 집어올 산출물 파일명.
     *  AGENT_TASK_SCHEDULE_PUBLISH_FILE(기본 report.html). */
    SCHEDULE_PUBLISH_FILE: process.env.AGENT_TASK_SCHEDULE_PUBLISH_FILE || 'report.html',
    /** 게시 파일명 날짜의 기준 TZ — 서버·컨테이너가 UTC 여도 날짜가 하루 밀리지 않게 명시.
     *  AGENT_TASK_SCHEDULE_PUBLISH_TZ(기본 Asia/Seoul). */
    SCHEDULE_PUBLISH_TZ: process.env.AGENT_TASK_SCHEDULE_PUBLISH_TZ || 'Asia/Seoul',
    /** 크로스-task 학습(Phase 5-2) — 유저 과거 유사 작업의 결과·도구·실패사유를 새 task system 에
     *  주입(같은 실수 반복 방지). 무-LLM(키워드 유사도)·기존 테이블 파생. 기본 OFF.
     *  AGENT_TASK_LEARNING_ENABLED=true 로 활성. */
    LEARNING_ENABLED: process.env.AGENT_TASK_LEARNING_ENABLED === 'true',
    /** 학습 조회 대상 — 유저 최근 terminal task 수(기본 30). */
    LEARNING_LOOKBACK: parseInt(process.env.AGENT_TASK_LEARNING_LOOKBACK || '30', 10),
    /** 주입할 교훈 최대 건수(기본 3). */
    LEARNING_MAX_LESSONS: parseInt(process.env.AGENT_TASK_LEARNING_MAX_LESSONS || '3', 10),
    /** goal 유사도(자카드) 임계 — 미만은 무관 작업으로 간주(기본 0.2). */
    LEARNING_MIN_SIMILARITY: parseFloat(process.env.AGENT_TASK_LEARNING_MIN_SIMILARITY || '0.2'),
    /** 재생 가능 절차 스킬(#1 Procedural Skill) — 성공한 액션 시퀀스를 저장(skill_save)하고
     *  유사 goal 에서 LLM 재추론 없이 재생(skill_run). agent_skills(category='procedural') 재사용,
     *  신규 테이블 없음. skill_run 은 코드/브라우저를 실행하므로 승인 게이트상 high-risk. 기본 OFF.
     *  AGENT_TASK_PROCEDURAL_SKILLS=true 로 활성. */
    PROCEDURAL_SKILLS_ENABLED: process.env.AGENT_TASK_PROCEDURAL_SKILLS === 'true',
    /** 재사용 후보로 system 에 제안할 절차 스킬 최대 건수(기본 3). */
    PROCEDURAL_MAX_SUGGEST: parseInt(process.env.AGENT_TASK_PROCEDURAL_MAX_SUGGEST || '3', 10),
    /** Computer Use Stage 0: browser 액션 계측(browser_action_metrics 079)을 기록한다.
     *  a11y 폴백 실효 + canvas 신호(selector·a11y 동시 실패)를 주-단위로 집계해 Stage 1
     *  분기(State block vs Vision)를 데이터로 결정. 측정이 목적이라 기본 ON — 끄려면 =false. */
    BROWSER_METRICS_ENABLED: process.env.AGENT_TASK_BROWSER_METRICS !== 'false',
    /** 산출물 검증 모드(Phase 5-3): 'syntax'(기본 — py_compile·node --check) | 'run'(샌드박스에서
     *  실제 실행 후 exit code 검사 — network none·자원캡 격리라 안전하나 부작용 있는 코드는 실행됨). */
    VERIFY_MODE: (process.env.AGENT_TASK_VERIFY_MODE === 'run' ? 'run' : 'syntax') as 'syntax' | 'run',
    /** 서브에이전트 위임(Phase 5-1) — delegate 를 1-shot 자문에서 depth=1 미니 tool-loop 로 승격.
     *  기본 OFF(기존 1-shot 유지). AGENT_TASK_SUBAGENT_ENABLED=true 로 활성. */
    SUBAGENT_ENABLED: process.env.AGENT_TASK_SUBAGENT_ENABLED === 'true',
    /** 서브에이전트 턴 상한(작게 — 재귀·폭주 방지, 기본 3). */
    SUBAGENT_MAX_TURNS: parseInt(process.env.AGENT_TASK_SUBAGENT_MAX_TURNS || '3', 10),
    /** 서브에이전트 1회 위임당 토큰 상한 — 부모 누적에 합산되어 부모 한도도 함께 적용(기본 100k). */
    SUBAGENT_MAX_TOKENS: parseInt(process.env.AGENT_TASK_SUBAGENT_MAX_TOKENS || '100000', 10),
    /** 서브에이전트 활동 기록(109) — 기본 on. AGENT_TASK_SUBAGENT_TRACE_ENABLED=false 로 끔. */
    SUBAGENT_TRACE_ENABLED: process.env.AGENT_TASK_SUBAGENT_TRACE_ENABLED !== 'false',
    /** 서브 스텝 본문 상한(자) — 도구 결과 전문은 부모 tool_result 에 이미 있으므로 미리보기만. */
    SUBAGENT_TRACE_CONTENT_CAP: parseInt(process.env.AGENT_TASK_SUBAGENT_TRACE_CAP || '2000', 10),
    /** 서브에이전트 라벨 상한(자) — role/agentId 가 없을 때 서브목표 앞부분을 라벨로 쓴다.
     *  진행 목록에서 한 줄로 읽히는 길이. AGENT_TASK_SUBAGENT_LABEL_MAX. */
    SUBAGENT_LABEL_MAX_CHARS: parseInt(process.env.AGENT_TASK_SUBAGENT_LABEL_MAX || '60', 10),
    /** 동적 도구 선별 방식(Phase 5-4): 'keyword'(기본 — 무-LLM 오버랩) | 'embedding'(bge-m3 코사인,
     *  어휘가 달라도 의미 매칭. 실패 시 키워드 폴백). AGENT_TASK_DYNAMIC_TOOLS_MODE. */
    DYNAMIC_TOOLS_MODE: (process.env.AGENT_TASK_DYNAMIC_TOOLS_MODE === 'embedding' ? 'embedding' : 'keyword') as 'keyword' | 'embedding',
    /** 임베딩 모드 유사도 임계 — 미만은 예산이 남아도 제외(무관 도구 미주입, 기본 0.35). */
    DYNAMIC_TOOLS_EMBED_MIN_SIM: parseFloat(process.env.AGENT_TASK_DYNAMIC_TOOLS_EMBED_MIN_SIM || '0.35'),
    /** 임베딩 선별 전체 타임아웃(ms) — 초과 시 키워드 폴백(기본 3000). */
    DYNAMIC_TOOLS_EMBED_TIMEOUT_MS: parseInt(process.env.AGENT_TASK_DYNAMIC_TOOLS_EMBED_TIMEOUT_MS || '3000', 10),
    /** 턴 중간 체크포인트(Phase 6-4) — 도구 결과 단위로도 checkpoint 저장. 재시작이 턴 중간에
     *  일어나도 이미 실행된 도구를 재실행하지 않고 재개한다(write 도구 재실행 방지 강화).
     *  기본 ON(124) — 턴 중간 재개(turn-reentry)와 도구 호출 저널은 이 체크포인트가 있어야 남은
     *  호출을 구분할 수 있다. 운영도 2026-08 부터 ON 이었다. AGENT_TASK_MIDTURN_CHECKPOINT=false 로 끈다. */
    MIDTURN_CHECKPOINT_ENABLED: process.env.AGENT_TASK_MIDTURN_CHECKPOINT !== 'false',
    /** 실행 중 표식(172) — 부작용 도구는 실행 직전 tool_call id 를 남기고, 재개 때 그 호출이 저널에 없으면
     *  다시 실행하지 않고 "결과 불명" 안내를 도구 결과로 준다(중복 부작용 방지). 기본 ON.
     *  AGENT_TASK_REENTRY_UNKNOWN_OUTCOME=false 면 종전처럼 결과 없는 호출을 모두 다시 실행한다. */
    REENTRY_UNKNOWN_OUTCOME_ENABLED: process.env.AGENT_TASK_REENTRY_UNKNOWN_OUTCOME !== 'false',
    /** 결과 불명 호출을 만나면 사용자에게 묻는다(질문 채널) — 승인하면 다시 실행, 거절·무응답이면 안내만 주고 다시 실행하지 않는다.
     *  기본 ON. AGENT_TASK_REENTRY_UNKNOWN_OUTCOME_ASK=false 면 묻지 않고 안내만 준다(172 의 처음 동작). */
    REENTRY_UNKNOWN_OUTCOME_ASK: process.env.AGENT_TASK_REENTRY_UNKNOWN_OUTCOME_ASK !== 'false',
    /** 실행 중 중간 지시(steering) — 실행 중 task 에 사용자가 방향 지시를 주입하면 다음 턴 경계에서
     *  conversation 에 user 메시지로 반영(취소·재시작 없이 교정). steering 은 사용자가 명시적으로
     *  보낼 때만 동작하므로 기본 ON. AGENT_TASK_STEERING=false 로 비활성. */
    STEERING_ENABLED: process.env.AGENT_TASK_STEERING !== 'false',
    /** steering 메시지 1건 최대 글자 수. AGENT_TASK_STEERING_MAX_CHARS(기본 2000). */
    STEERING_MAX_CHARS: parseInt(process.env.AGENT_TASK_STEERING_MAX_CHARS || '2000', 10),
    /** task 당 미소비 steering 대기 상한 — 초과 시 429(플러딩 방지). AGENT_TASK_STEERING_MAX_PENDING(기본 10). */
    STEERING_MAX_PENDING: parseInt(process.env.AGENT_TASK_STEERING_MAX_PENDING || '10', 10),
    /** execute 의 allowedSkills 배열 상한 — 초과 시 400(잘라내지 않는다). AGENT_TASK_EXECUTE_MAX_ALLOWED_SKILLS(기본 50). */
    EXECUTE_MAX_ALLOWED_SKILLS: parseInt(process.env.AGENT_TASK_EXECUTE_MAX_ALLOWED_SKILLS || '50', 10),
} as const;

