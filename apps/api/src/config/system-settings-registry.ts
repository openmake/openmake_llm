/**
 * @module config/system-settings-registry
 * @description system_settings 허용 키 화이트리스트 (L2 config).
 *
 * admin 시스템 설정(DB system_settings 테이블)으로 관리 가능한 운영 설정 키를
 * 정의한다. 여기 없는 키는 API 가 저장을 거부한다 (임의 키 저장 금지).
 * 해석 우선순위는 DB > env > 기본값 (config/env.ts applySettingsOverlay).
 *
 * 범위 제외(계속 .env 전용): DATABASE_URL/PORT(부트스트랩 순환),
 * JWT_SECRET/API_KEY_PEPPER/TOKEN_ENCRYPTION_KEY(런타임 변경 시 세션·암호문 무효화,
 * 특히 TOKEN_ENCRYPTION_KEY 는 이 테이블 암호화의 뿌리), CORS_ORIGINS/COOKIE_SECURE
 * (admin 탈취 시 UI 로 보안 경계 개방 방지).
 *
 * @see docs/superpowers/plans/2026-08-12-system-settings-admin-ui.md
 */
import { z } from 'zod';

export type SettingGroup = 'oauth' | 'search' | 'alerts' | 'push' | 'llm' | 'agent' | 'slo';

interface SystemSettingDef {
    /** env 변수명과 동일한 설정 키 */
    key: string;
    group: SettingGroup;
    /** true 면 AES-256-GCM 암호화 저장 + API 응답에 값 미포함 (write-only) */
    secret: boolean;
    /** true 면 저장은 되되 부팅 시 구성 요소(cluster 등)라 재시작 후 반영 */
    requiresRestart: boolean;
    /** 키별 형식 검증 — 빈 문자열 저장 금지 (해제는 DELETE 로 env 폴백 복귀) */
    validate: z.ZodType<string>;
    /** 키 발급 콘솔 URL — admin UI 가 입력란 옆에 바로가기 링크로 노출 (발급처 없는 키는 생략) */
    issueUrl?: string;
}

const nonEmpty = z.string().trim().min(1, '값이 비어 있습니다').max(2000, '2000자 이하여야 합니다');
/** API 키 필드용 — 발급 페이지 URL 을 키로 착각해 붙여넣는 실수 차단 (실사례: EXA_API_KEY 에 URL 등록 → 조용한 0건) */
const apiKeyLike = nonEmpty.refine((v) => !/^https?:\/\//i.test(v), 'URL 이 아니라 발급받은 API 키 값을 입력하세요');
const httpUrl = nonEmpty.refine((v) => /^https?:\/\//.test(v), 'http(s):// URL 이어야 합니다');
const httpsUrl = nonEmpty.refine((v) => /^https:\/\//.test(v), 'https:// URL 이어야 합니다');
const nonNegativeIntString = z
    .string()
    .trim()
    .regex(/^\d+$/, '0 이상의 정수여야 합니다');
/** JSON 객체 문자열 — 외부 모델 정책({"allow":[…],"deny":[…]}) 같은 구조 설정. */
const jsonObject = nonEmpty.refine((v) => {
    try { const o = JSON.parse(v); return !!o && typeof o === 'object' && !Array.isArray(o); } catch { return false; }
}, 'JSON 객체여야 합니다 (예: {"deny":["openrouter:*"]})');
/** 백분율 목표 — 0 초과 100 미만 소수(예: 99.5) */
const percentTarget = nonEmpty.refine((v) => /^\d{1,2}(\.\d{1,3})?$/.test(v) && Number(v) > 0 && Number(v) < 100, '0 초과 100 미만 백분율이어야 합니다 (예: 99.5)');
const mailtoOrHttps = nonEmpty.refine(
    (v) => /^(mailto:|https:\/\/)/.test(v),
    'mailto: 또는 https:// 형식이어야 합니다',
);

/** 발급 콘솔 URL — 같은 콘솔을 쓰는 키(ID/SECRET 쌍)가 공유 */
const ISSUE_URLS = {
    googleCloud: 'https://console.cloud.google.com/apis/credentials',
    googleCse: 'https://programmablesearchengine.google.com/controlpanel/all',
    github: 'https://github.com/settings/developers',
    kakao: 'https://developers.kakao.com/console/app',
    naverDev: 'https://developers.naver.com/apps',
    ncpHub: 'https://console.ncloud.com/naver-api-hub/application',
    exa: 'https://dashboard.exa.ai/api-keys',
    tavily: 'https://app.tavily.com/home',
    openrouter: 'https://openrouter.ai/settings/keys',
    ollamaCloud: 'https://ollama.com/settings/keys',
    nvidiaNim: 'https://build.nvidia.com/settings/api-keys',
} as const;

export const SYSTEM_SETTINGS_REGISTRY: SystemSettingDef[] = [
    // ── OAuth (소셜 로그인) — 미설정 시 해당 provider 로그인 비활성 ──
    { key: 'GOOGLE_CLIENT_ID', group: 'oauth', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.googleCloud },
    { key: 'GOOGLE_CLIENT_SECRET', group: 'oauth', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.googleCloud },
    { key: 'OAUTH_REDIRECT_URI', group: 'oauth', secret: false, requiresRestart: false, validate: httpUrl },
    { key: 'GITHUB_CLIENT_ID', group: 'oauth', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.github },
    { key: 'GITHUB_CLIENT_SECRET', group: 'oauth', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.github },
    { key: 'KAKAO_CLIENT_ID', group: 'oauth', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.kakao },
    { key: 'KAKAO_CLIENT_SECRET', group: 'oauth', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.kakao },

    // ── 웹 검색 (Google CSE / Naver) — 미설정 시 해당 검색 소스만 비활성 ──
    { key: 'GOOGLE_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.googleCloud },
    { key: 'GOOGLE_CSE_ID', group: 'search', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.googleCse },
    { key: 'NAVER_CLIENT_ID', group: 'search', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.naverDev },
    { key: 'NAVER_CLIENT_SECRET', group: 'search', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.naverDev },
    { key: 'NAVER_API_HUB_KEY_ID', group: 'search', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.ncpHub },
    { key: 'NAVER_API_HUB_KEY', group: 'search', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.ncpHub },
    { key: 'NAVER_API_DAILY_LIMIT', group: 'search', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    { key: 'KAKAO_REST_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.kakao },
    { key: 'EXA_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.exa },
    { key: 'TAVILY_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.tavily },

    // ── 운영 알림 webhook — URL 자체가 발송 자격증명이라 전부 secret ──
    { key: 'OPERATOR_WEBHOOK_URL', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },
    { key: 'OPERATOR_WEBHOOK_URL_CRITICAL', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },
    { key: 'OPERATOR_WEBHOOK_URL_WARNING', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },
    { key: 'OPERATOR_WEBHOOK_URL_INFO', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },

    // ── 웹 푸시 (VAPID) ──
    { key: 'VAPID_PUBLIC_KEY', group: 'push', secret: false, requiresRestart: false, validate: nonEmpty },
    { key: 'VAPID_PRIVATE_KEY', group: 'push', secret: true, requiresRestart: false, validate: nonEmpty },
    { key: 'VAPID_SUBJECT', group: 'push', secret: false, requiresRestart: false, validate: mailtoOrHttps },

    // ── LLM 게이트웨이 — base URL/key 는 cluster manager 가 부팅 시 구성 → 재시작 필요 ──
    { key: 'LLM_BASE_URL', group: 'llm', secret: false, requiresRestart: true, validate: httpUrl },
    { key: 'LLM_API_KEY', group: 'llm', secret: true, requiresRestart: true, validate: apiKeyLike },
    { key: 'LLM_DEFAULT_MODEL', group: 'llm', secret: false, requiresRestart: false, validate: nonEmpty },
    // ── Control Plane 기초(2026-09-16): 토큰 예산·외부 모델 정책을 관리자 UI 에서 실시간 조정 ──
    { key: 'LLM_HOURLY_TOKEN_LIMIT', group: 'llm', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    { key: 'LLM_WEEKLY_TOKEN_LIMIT', group: 'llm', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    { key: 'EXTERNAL_MODEL_POLICY', group: 'llm', secret: false, requiresRestart: false, validate: jsonObject },
    { key: 'QUOTA_FAIL_MODE', group: 'llm', secret: false, requiresRestart: false, validate: z.enum(['open', 'closed']) },
    { key: 'QUOTA_EXCEEDED_ACTION', group: 'llm', secret: false, requiresRestart: false, validate: z.enum(['reject', 'degrade']) },
    { key: 'QUOTA_DEGRADE_MODEL_MAP', group: 'llm', secret: false, requiresRestart: false, validate: jsonObject },
    { key: 'USER_MONTHLY_COST_BUDGET_MICROS', group: 'llm', secret: false, requiresRestart: false, validate: nonNegativeIntString },

    // ── 에이전트·MCP 런타임(F13/F16, 2026-09-17) — 실시간 반영(getConfig 를 호출 시점에 읽는 소비자) ──
    { key: 'MCP_TOOL_LIST_STALE_MS', group: 'agent', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    { key: 'AGENT_TASK_HITL_PARK_ON_TIMEOUT', group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    { key: 'AGENT_TASK_QUEUE_PRIORITY_MAX', group: 'agent', secret: false, requiresRestart: false, validate: nonNegativeIntString },

    // ── SLO 목표(F24.8, 145) — 5분 평가 tick 이 호출 시점에 읽는다(실시간) ──
    { key: 'SLO_CHAT_AVAILABILITY_TARGET', group: 'slo', secret: false, requiresRestart: false, validate: percentTarget },
    { key: 'SLO_CHAT_TTFT_P95_MS', group: 'slo', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    { key: 'SLO_AGENT_TASK_SUCCESS_TARGET', group: 'slo', secret: false, requiresRestart: false, validate: percentTarget },
    { key: 'SLO_EVAL_PASS_TARGET', group: 'slo', secret: false, requiresRestart: false, validate: percentTarget },

    // ── 외부 LLM provider 키 — 저장/삭제 시 "관리자 본인"의 user_external_api_keys(BYOK)로
    //    연동된다 (admin-system-settings.routes 의 syncAdminProviderKey). 런타임 키 해석 경로는
    //    기존 사용자별 BYOK 그대로 — 다른 사용자에게 공용 키를 열지 않는다 (비용 격리 유지). ──
    { key: 'OPENROUTER_API_KEY', group: 'llm', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.openrouter },
    { key: 'OLLAMA_CLOUD_API_KEY', group: 'llm', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.ollamaCloud },
    { key: 'NVIDIA_API_KEY', group: 'llm', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.nvidiaNim },
];

export const SETTING_DEFS_BY_KEY: ReadonlyMap<string, SystemSettingDef> = new Map(
    SYSTEM_SETTINGS_REGISTRY.map((def) => [def.key, def]),
);
