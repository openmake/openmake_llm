/**
 * ============================================================
 * HTTP·데이터 계층 한계값 중앙 관리
 * ============================================================
 * routes·controllers 의 페이지네이션, data 계층의 SQL 결과 상한,
 * schemas 의 Zod 입력 길이·개수 한계를 한곳에 모은다.
 * (모델명·프롬프트·LLM 파라미터는 다른 config 소관.)
 *
 * @module config/http-data-limits
 */

const envInt = (name: string, def: number): number =>
    parseInt(process.env[name] || '', 10) || def;

// ============================================================
// 페이지네이션 (routes·controllers 목록 조회)
// ============================================================

/**
 * 목록 조회 공통 페이지네이션 기본값·상한.
 * 클라이언트가 limit/offset 을 안 주거나 과도하게 요청할 때의 안전값.
 */
export const PAGINATION = {
    /** 일반 목록 기본 limit */
    DEFAULT_LIMIT: 50,
    /** 감사/설정 등 관리 목록 기본 limit */
    ADMIN_DEFAULT_LIMIT: 100,
    /** 관리 목록 최대 limit (무거운 query 방어) */
    ADMIN_MAX_LIMIT: 500,
    /** 외부 키 사용량 등 목록 최대 limit */
    LIST_MAX_LIMIT: 200,
    /** 세션/에이전트 목록 등 기본 limit */
    SESSION_DEFAULT_LIMIT: 100,
    /** 관리자 사용자 목록 기본 limit */
    USERS_DEFAULT_LIMIT: 20,
    /** 관리자 사용자 목록 최대 limit */
    USERS_MAX_LIMIT: 100,
    /** offset 기본값 */
    DEFAULT_OFFSET: 0,
    /** 통계 조회 기본 일수 */
    DEFAULT_STATS_DAYS: 7,
    /** 통계 조회 기본 일수 (월 단위 뷰) */
    DEFAULT_MONTH_DAYS: 30,
    /** 통계 조회 최대 일수 (분기~연 단위) */
    MAX_STATS_DAYS_QUARTER: 90,
    /** 통계 조회 최대 일수 (연 단위) */
    MAX_STATS_DAYS_YEAR: 365,
    /** 대기 승인 조회 기본 분 */
    APPROVAL_DEFAULT_MINUTES: 30,
    /** 대기 승인 조회 최대 분 (24h) */
    APPROVAL_MAX_MINUTES: 24 * 60,
} as const;

// ============================================================
// SQL 결과 상한 (data 계층 — LIMIT n)
// ============================================================

/**
 * 파라미터화 SQL 의 LIMIT 값. 단일 행 조회(LIMIT 1)는 구조적이라 제외.
 * 값은 숫자 상수로만 SQL 에 바인딩한다($n).
 */
export const SQL_RESULT_LIMITS = {
    /** 세션 트리 자식 세션 조회 상한 */
    SESSION_TREE_CHILDREN: envInt('SESSION_TREE_CHILDREN_LIMIT', 100),
    /** 사용자별 MCP 서버 인스턴스 목록 상한 */
    MCP_INSTANCE_LIST: envInt('MCP_INSTANCE_LIST_LIMIT', 100),
} as const;

// ============================================================
// Zod 입력 스키마 길이·개수 한계 (schemas/*)
// ============================================================

/** Git 인제스트 공통 필드(agent/extension/mcp-server ingest 공용) */
const INGEST = {
    /** gitUrl 최소/최대 길이 */
    GIT_URL_MIN: 3,
    GIT_URL_MAX: 500,
    /** mcp-server ingest 는 별도 상·하한 */
    MCP_GIT_URL_MIN: 3,
    MCP_GIT_URL_MAX: 400,
    /** gitRef 최대 길이 */
    GIT_REF_MAX: 200,
    /** gitPath 최대 길이 */
    GIT_PATH_MAX: 500,
    /** mcp-server ingest gitPath 최대 길이 */
    MCP_GIT_PATH_MAX: 300,
    /** accessToken 최대 길이(요청 한정, DB 미저장) */
    ACCESS_TOKEN_MAX: 200,
    /** plugin 식별자 최대 길이 */
    PLUGIN_MAX: 120,
    /** category 최대 길이 */
    CATEGORY_MAX: 50,
    /** env override 키/값 최대 길이 */
    ENV_KEY_MAX: 200,
    ENV_VALUE_MAX: 2000,
} as const;

/**
 * Zod 스키마 입력 한계. 필드 길이·배열 개수 상한.
 * 외부/프로토콜 상수(port 65535·email 254·hostname 253·위경도·확률 0~1)와
 * 구조적 하한(min(0)/min(1))은 스키마에 그대로 두고 여기 두지 않는다.
 */
export const SCHEMA_LIMITS = {
    ingest: INGEST,

    push: {
        /** endpoint URL 최대 길이 */
        ENDPOINT_MAX: 2048,
        /** deviceToken 최소/최대 길이 */
        DEVICE_TOKEN_MIN: 16,
        DEVICE_TOKEN_MAX: 512,
        /** bundleId 최소/최대 길이 */
        BUNDLE_ID_MIN: 3,
        BUNDLE_ID_MAX: 255,
    },

    audit: {
        /** action 최대 길이 */
        ACTION_MAX: 100,
        /** resourceType 최대 길이 */
        RESOURCE_TYPE_MAX: 200,
        /** resourceId 최대 길이 */
        RESOURCE_ID_MAX: 500,
    },

    agents: {
        /** rating 평점 척도 (1~5) */
        RATING_MIN: 1,
        RATING_MAX: 5,
        /** query 최대 길이 */
        QUERY_MAX: 5000,
        /** response 최대 길이 */
        RESPONSE_MAX: 10000,
        /** comment 최대 길이 */
        COMMENT_MAX: 2000,
        /** tag 개별 최대 길이 / 태그 수 상한 */
        TAG_MAX: 50,
        TAGS_COUNT_MAX: 20,
        /** priority 범위 (0~100) */
        PRIORITY_MIN: 0,
        PRIORITY_MAX: 100,
    },

    mcp: {
        /** command 최대 길이 */
        COMMAND_MAX: 1000,
        /** args 원소 최대 길이 / 개수 상한 */
        ARG_MAX: 500,
        ARGS_COUNT_MAX: 50,
        /** catalog_template_id 최대 길이 */
        CATALOG_TEMPLATE_ID_MAX: 200,
        /** env 키/값 최대 길이 / 한 번에 변경 가능한 키 수 */
        ENV_KEY_MAX: 100,
        ENV_VALUE_MAX: 10000,
        ENV_COUNT_MAX: 30,
        /** 서버 이름 최대 길이 */
        NAME_MAX: 128,
    },

    mcpCatalog: {
        /** id 최대 길이 */
        ID_MAX: 64,
        /** display_name 최대 길이 */
        DISPLAY_NAME_MAX: 128,
        /** description 최대 길이 */
        DESCRIPTION_MAX: 512,
        /** template_id 최대 길이 */
        TEMPLATE_ID_MAX: 64,
        /** 인스턴스 name 최대 길이 */
        NAME_MAX: 128,
    },

    mcpCatalogAdmin: {
        /** id 최소/최대 길이 */
        ID_MIN: 3,
        ID_MAX: 100,
        /** display_name 최대 길이 */
        DISPLAY_NAME_MAX: 200,
        /** description 최대 길이 */
        DESCRIPTION_MAX: 1000,
        /** command_template 최대 길이 */
        COMMAND_TEMPLATE_MAX: 2000,
        /** url_template 최대 길이 */
        URL_TEMPLATE_MAX: 500,
        /** OAuth clientId 최대 길이 */
        CLIENT_ID_MAX: 300,
        /** OAuth clientSecret 최대 길이 */
        CLIENT_SECRET_MAX: 500,
        /** OAuth scope 최대 길이 */
        SCOPE_MAX: 2000,
        /** authorizationParams 값 최대 길이 */
        AUTH_PARAM_VALUE_MAX: 200,
    },

    skills: {
        /** name 최대 길이 */
        NAME_MAX: 200,
        /** description 최대 길이 */
        DESCRIPTION_MAX: 2000,
        /** content 최대 길이 */
        CONTENT_MAX: 50000,
        /** category 최대 길이 */
        CATEGORY_MAX: 100,
        /** search 쿼리 최대 길이 */
        SEARCH_MAX: 200,
        /** purpose 최소/최대 길이 */
        PURPOSE_MIN: 5,
        PURPOSE_MAX: 500,
        /** example 개별 최대 길이 / 개수 상한 */
        EXAMPLE_MAX: 500,
        EXAMPLES_COUNT_MAX: 5,
        /** hints 최대 길이 */
        HINTS_MAX: 1000,
        /** skillId 최대 길이 / 배정 개수 상한 */
        SKILL_ID_MAX: 128,
        SKILL_IDS_COUNT_MAX: 50,
        /** 생성 스킬 name 최소/최대 */
        CREATE_NAME_MIN: 5,
        CREATE_NAME_MAX: 100,
        /** 생성 스킬 description 최소/최대 */
        CREATE_DESCRIPTION_MIN: 10,
        CREATE_DESCRIPTION_MAX: 500,
        /** 생성 스킬 content 최소/최대 */
        CREATE_CONTENT_MIN: 200,
        CREATE_CONTENT_MAX: 20000,
        /** trigger 개별 최대 길이 / 개수 상한 */
        TRIGGER_MAX: 50,
        TRIGGERS_COUNT_MAX: 20,
        /** tag 개별 최대 길이 / 개수 상한 */
        TAG_MAX: 30,
        TAGS_COUNT_MAX: 10,
        /** 검색 limit 기본/최대, 배정 목록 limit 기본/최대 */
        SEARCH_LIMIT_DEFAULT: 20,
        SEARCH_LIMIT_MAX: 200,
        LIST_LIMIT_DEFAULT: 50,
        LIST_LIMIT_MAX: 100,
    },

    skillManifest: {
        /** tool_name 최대 길이 */
        TOOL_NAME_MAX: 128,
        /** server_name 최대 길이 */
        SERVER_NAME_MAX: 64,
        /** name 최대 길이 */
        NAME_MAX: 128,
        /** category 최대 길이 */
        CATEGORY_MAX: 64,
        /** tool_bindings 개수 상한 */
        TOOL_BINDINGS_COUNT_MAX: 64,
        /** mcp_bundles 개수 상한 */
        MCP_BUNDLES_COUNT_MAX: 8,
        /** source_path 최대 길이 */
        SOURCE_PATH_MAX: 256,
    },

    webSearch: {
        /** query 최대 길이 */
        QUERY_MAX: 1000,
        /** model 최대 길이 */
        MODEL_MAX: 100,
    },

    chat: {
        /** 첨부 id 최대 길이 */
        ATTACHMENT_ID_MAX: 200,
        /** 첨부 name 최대 길이 */
        ATTACHMENT_NAME_MAX: 255,
        /** 첨부 type 최대 길이 */
        ATTACHMENT_TYPE_MAX: 100,
        /** modes 키 최대 길이 */
        MODE_KEY_MAX: 80,
        /** userAgentId 최대 길이 */
        USER_AGENT_ID_MAX: 64,
    },

    auth: {
        /** 새 비밀번호 최소 길이 */
        PASSWORD_MIN: 8,
        /** consentLocale 최소/최대 길이 */
        CONSENT_LOCALE_MIN: 2,
        CONSENT_LOCALE_MAX: 10,
    },

    external: {
        /** 토큰(access/refresh) 최대 길이 */
        TOKEN_MAX: 2000,
        /** accountName 최대 길이 */
        ACCOUNT_NAME_MAX: 200,
        /** externalId·fileName 최대 길이 */
        EXTERNAL_ID_MAX: 500,
        FILE_NAME_MAX: 500,
        /** fileType 최대 길이 */
        FILE_TYPE_MAX: 100,
        /** webUrl 최대 길이 */
        WEB_URL_MAX: 2000,
        /** cachedContent 최대 길이 */
        CACHED_CONTENT_MAX: 1_000_000,
    },

    conversationOrg: {
        /** 폴더 position 상한 */
        POSITION_MAX: 10_000,
        /** folderId 최대 길이 */
        FOLDER_ID_MAX: 64,
        /** tag 개별 최대 길이 / 개수 상한 */
        TAG_MAX: 200,
        TAGS_COUNT_MAX: 50,
    },

    chatFeedback: {
        /** messageId·sessionId 최대 길이 */
        MESSAGE_ID_MAX: 255,
        SESSION_ID_MAX: 255,
    },

    nodes: {
        /** 노드 name 최대 길이 */
        NAME_MAX: 100,
    },

    agentTask: {
        /** 입력 첨부 id·type 최대 길이 */
        FILE_ID_MAX: 100,
        FILE_TYPE_MAX: 100,
        /** deviceId 최대 길이 */
        DEVICE_ID_MAX: 64,
        /** folderRel 상대경로 최대 길이 */
        FOLDER_REL_MAX: 512,
        /** allowedSkills 원소(스킬 id) 최대 길이 */
        ALLOWED_SKILL_MAX: 200,
        /** cron 표현식 최대 길이 */
        CRON_MAX: 120,
        /** intervalSeconds 최대 (365일, 초) */
        INTERVAL_SECONDS_MAX: 365 * 24 * 3600,
        /** 템플릿 파라미터 name·description·default 최대 길이 */
        PARAM_NAME_MAX: 50,
        PARAM_DESCRIPTION_MAX: 200,
        PARAM_DEFAULT_MAX: 500,
        /** 템플릿 name 최대 길이 / params 개수 상한 */
        TEMPLATE_NAME_MAX: 100,
        PARAMS_COUNT_MAX: 10,
        /** instantiate 파라미터 값 최대 길이 */
        PARAM_VALUE_MAX: 2000,
    },
} as const;

/**
 * secureTextSchema(security.schema) 기본값 — 호출부가 옵션을 안 줄 때 적용.
 */
export const SECURE_TEXT_DEFAULTS = {
    /** 기본 최대 길이(문자) */
    MAX_LENGTH: 10000,
    /** 특수문자 비율 상한 — 초과 시 비정상 입력으로 거절 */
    SPECIAL_CHAR_RATIO_LIMIT: 0.65,
} as const;

/**
 * validation 미들웨어(middlewares/validation.ts) 기본값.
 * body/파일 크기 상한은 배포 환경(프록시·edge 상한)에 따라 다를 수 있어 env 오버라이드.
 */
export const VALIDATION_DEFAULTS = {
    /** JSON body 기본 상한(bytes) — 1MB */
    BODY_MAX_BYTES: envInt('VALIDATION_BODY_MAX_BYTES', 1 * 1024 * 1024),
    /** 멀티파트 업로드 기본 body 상한(bytes) — 100MB */
    UPLOAD_BODY_MAX_BYTES: envInt('VALIDATION_UPLOAD_BODY_MAX_BYTES', 100 * 1024 * 1024),
    /** 업로드 파일 개별 기본 상한(bytes) — 300MB */
    FILE_MAX_BYTES: envInt('VALIDATION_FILE_MAX_BYTES', 300 * 1024 * 1024),
    /** 특수문자 비율 상한 기본값 */
    SPECIAL_CHAR_RATIO_LIMIT: 0.7,
    /** 업로드 차단 확장자(실행 파일) */
    BLOCKED_UPLOAD_EXTENSIONS: ['.exe', '.dll', '.bat', '.cmd', '.ps1'],
} as const;
