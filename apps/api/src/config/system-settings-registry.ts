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
 */
import { z } from 'zod';
import { browserSitePolicyProblems } from '@openmake/config';
import { contributedSettings, type AddonSettingValidator } from '../addon-host/contributions';
import { EXTENSION_ADMIN_INVENTORY_KEY } from './extension-admin-inventory';
import { ADDON_LIST_REFLECT_DB_STATE_KEY } from './addon-list-state';
import { ARBITRARY_URL_INSTALL_MODES, EXTENSION_SOURCE_POLICY_KEYS, extensionSourcePolicyProblems } from './extension-source-policy';
import { EXTENSION_MCP_SERVER_POLICY_KEYS, extensionMcpServerPolicyProblems } from './extension-mcp-server-policy';
import { EXTENSION_CATALOG_SYNC_KEYS } from './extension-catalog-sync';
import { EXTENSION_INSTALL_PREVIEW_FLAG } from './extension-install-preview';
import { EXTENSION_REMOTE_MCP_FLAG } from './extension-remote-mcp';
import { EXTENSION_ORG_DEPLOYMENT_FLAG } from './extension-org-deployment';

/** Base 그룹 또는 add-on 이 기여한 그룹 이름 */
export type SettingGroup = 'oauth' | 'search' | 'alerts' | 'push' | 'llm' | 'agent' | 'slo' | (string & {});

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
const positiveIntString = z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, '1 이상의 정수여야 합니다');
/** JSON 객체 문자열 — 외부 모델 정책({"allow":[…],"deny":[…]}) 같은 구조 설정. */
const jsonObject = nonEmpty.refine((v) => {
    try { const o = JSON.parse(v); return !!o && typeof o === 'object' && !Array.isArray(o); } catch { return false; }
}, 'JSON 객체여야 합니다 (예: {"deny":["openrouter:*"]})');
/** 브라우저 사이트 정책 — 관리자 화면 편집기와 같은 패턴 검증(@openmake/config browserSitePolicyProblems) */
const browserSitePolicy = nonEmpty.superRefine((v, ctx) => {
    const problems = browserSitePolicyProblems(v);
    if (problems.length > 0) {
        ctx.addIssue({ code: 'custom', message: `사이트 정책이 올바르지 않습니다 (예: {"allow":["groupware.example.co.kr","*.intra.example.co.kr"],"deny":[]}): ${problems.join(', ')}` });
    }
});
/** 확장 원본 정책 — 조직 정책과 같은 스키마(config/extension-source-policy) */
const extensionSourcePolicy = nonEmpty.superRefine((v, ctx) => {
    const problems = extensionSourcePolicyProblems(v);
    if (problems.length > 0) {
        ctx.addIssue({ code: 'custom', message: `확장 원본 정책이 올바르지 않습니다 (예: {"allow":[{"type":"github","repo":"openmake/*"}],"deny":[]}): ${problems.join(', ')}` });
    }
});
/** 확장 MCP 서버 정책 — 조직 정책과 같은 스키마(config/extension-mcp-server-policy) */
const extensionMcpServerPolicy = nonEmpty.superRefine((v, ctx) => {
    const problems = extensionMcpServerPolicyProblems(v);
    if (problems.length > 0) {
        ctx.addIssue({ code: 'custom', message: `확장 MCP 서버 정책이 올바르지 않습니다 (예: {"allow":[{"type":"command","command":"npx","package":"@modelcontextprotocol/*"},{"type":"url","url":"https://mcp.example.com"}],"deny":[]}): ${problems.join(', ')}` });
    }
});
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
    openrouter: 'https://openrouter.ai/settings/keys',
    ollamaCloud: 'https://ollama.com/settings/keys',
    nvidiaNim: 'https://build.nvidia.com/settings/api-keys',
} as const;

const BASE_SYSTEM_SETTINGS: SystemSettingDef[] = [
    // ── OAuth (소셜 로그인) — 미설정 시 해당 provider 로그인 비활성 ──
    { key: 'GOOGLE_CLIENT_ID', group: 'oauth', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.googleCloud },
    { key: 'GOOGLE_CLIENT_SECRET', group: 'oauth', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.googleCloud },
    { key: 'OAUTH_REDIRECT_URI', group: 'oauth', secret: false, requiresRestart: false, validate: httpUrl },
    { key: 'GITHUB_CLIENT_ID', group: 'oauth', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.github },
    { key: 'GITHUB_CLIENT_SECRET', group: 'oauth', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.github },
    { key: 'KAKAO_CLIENT_ID', group: 'oauth', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.kakao },
    { key: 'KAKAO_CLIENT_SECRET', group: 'oauth', secret: true, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.kakao },

    // ── 웹 검색 (Google CSE) — 미설정 시 해당 검색 소스만 비활성. 지역·유료 공급원의 키는 그 add-on 이 기여한다 ──
    { key: 'GOOGLE_API_KEY', group: 'search', secret: true, requiresRestart: false, validate: apiKeyLike, issueUrl: ISSUE_URLS.googleCloud },
    { key: 'GOOGLE_CSE_ID', group: 'search', secret: false, requiresRestart: false, validate: nonEmpty, issueUrl: ISSUE_URLS.googleCse },

    // ── 운영 알림 webhook — URL 자체가 발송 자격증명이라 전부 secret ──
    { key: 'OPERATOR_WEBHOOK_URL', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },
    { key: 'OPERATOR_WEBHOOK_URL_CRITICAL', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },
    { key: 'OPERATOR_WEBHOOK_URL_WARNING', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },
    { key: 'OPERATOR_WEBHOOK_URL_INFO', group: 'alerts', secret: true, requiresRestart: false, validate: httpsUrl },

    // ── Discord 봇 ──

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
    // ── 로컬 vLLM 스케줄링 필드(PR-13) — LLMClient.chat 이 호출 시점에 읽는다(실시간). priority 는 DGX 정책이 켜져야 효과 ──
    { key: 'LLM_PREFIX_CACHE_SALT_MODE', group: 'llm', secret: false, requiresRestart: false, validate: z.enum(['off', 'user']) },
    { key: 'LLM_PRIORITY_ENABLED', group: 'llm', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },

    // ── 에이전트·MCP 런타임(F13/F16, 2026-09-17) — 실시간 반영(getConfig 를 호출 시점에 읽는 소비자) ──
    { key: 'MCP_TOOL_LIST_STALE_MS', group: 'agent', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    { key: 'AGENT_TASK_HITL_PARK_ON_TIMEOUT', group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    { key: 'AGENT_TASK_QUEUE_PRIORITY_MAX', group: 'agent', secret: false, requiresRestart: false, validate: nonNegativeIntString },
    // 로컬 브라우저 사이트 허용 목록(Companion P2) — {"allow":["groupware.example.co.kr"],"deny":[]}. 작업이 도구를 부를 때마다 읽는다(실시간)
    { key: 'BROWSER_SITE_POLICY', group: 'agent', secret: false, requiresRestart: false, validate: browserSitePolicy },
    // 확장 원본 정책(M2, opt-in) — 설치·업데이트·카탈로그 동기화가 호출 시점에 읽는다(실시간). 규칙은 config/extension-source-policy
    { key: EXTENSION_SOURCE_POLICY_KEYS.ENFORCED, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    { key: EXTENSION_SOURCE_POLICY_KEYS.ARBITRARY_URL_INSTALL, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(ARBITRARY_URL_INSTALL_MODES) },
    { key: EXTENSION_SOURCE_POLICY_KEYS.POLICY, group: 'agent', secret: false, requiresRestart: false, validate: extensionSourcePolicy },
    // 확장 MCP 서버 정책(§8-3, opt-in) — 확장 설치·MCP git 설치·카탈로그 등록이 호출 시점에 읽는다(실시간). 규칙은 config/extension-mcp-server-policy
    { key: EXTENSION_MCP_SERVER_POLICY_KEYS.ENFORCED, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    { key: EXTENSION_MCP_SERVER_POLICY_KEYS.POLICY, group: 'agent', secret: false, requiresRestart: false, validate: extensionMcpServerPolicy },
    // 관리자 확장 현황·정책 미리보기(M3, opt-in) — 라우트가 요청마다 읽는다(실시간)
    { key: EXTENSION_ADMIN_INVENTORY_KEY, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    // add-on 목록의 DB 상태 반영(§8-4, opt-in) — `GET /api/addons` 가 요청마다 읽는다(실시간)
    { key: ADDON_LIST_REFLECT_DB_STATE_KEY, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    // 확장 카탈로그 주기 동기화(M4, opt-in) — 5분 점검 tick 이 호출 시점에 읽는다(실시간). 간격은 양의 정수 ms
    { key: EXTENSION_CATALOG_SYNC_KEYS.AUTO_SYNC_ENABLED, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    { key: EXTENSION_CATALOG_SYNC_KEYS.SYNC_INTERVAL_MS, group: 'agent', secret: false, requiresRestart: false, validate: positiveIntString },
    { key: EXTENSION_CATALOG_SYNC_KEYS.INDEX_ENABLED, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    // 확장 설치 미리보기(M1b, opt-in) — 미리보기 라우트·갤러리 응답이 요청 시점에 읽는다(실시간). config/extension-install-preview
    { key: EXTENSION_INSTALL_PREVIEW_FLAG, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    // 확장 번들 원격 MCP 관리 등록(P8, opt-in) — 설치·승인·연결 시점에 읽는다(실시간). config/extension-remote-mcp
    { key: EXTENSION_REMOTE_MCP_FLAG, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },
    // 조직 확장 배포 모드(§8-1, opt-in) — 관리 라우트·갤러리 응답·제거 판정·조정 tick 이 호출 시점에 읽는다(실시간). config/extension-org-deployment
    { key: EXTENSION_ORG_DEPLOYMENT_FLAG, group: 'agent', secret: false, requiresRestart: false, validate: z.enum(['true', 'false']) },

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

/** add-on 기여 설정의 검증기 이름 → zod 스키마 (`oneOf` 는 기여가 준 허용 값으로 만든다 — contributedValidator) */
const CONTRIBUTED_VALIDATORS: Readonly<Record<Exclude<AddonSettingValidator, 'oneOf'>, z.ZodType<string>>> = {
    nonEmpty,
    apiKey: apiKeyLike,
    nonNegativeInt: nonNegativeIntString,
    boolean: z.enum(['true', 'false']),
};

/** 기여 설정 하나의 검증기 — 열거형(`oneOf`)은 allowedValues 밖의 값을 거절한다(목록이 비면 전부 거절) */
export function contributedValidator(d: { validate: AddonSettingValidator; allowedValues?: readonly string[] }): z.ZodType<string> {
    if (d.validate !== 'oneOf') return CONTRIBUTED_VALIDATORS[d.validate];
    const allowed = [...(d.allowedValues ?? [])];
    return z.string().trim().refine((v) => allowed.includes(v), `다음 중 하나여야 합니다: ${allowed.join(', ') || '(허용 값 없음)'}`);
}

/** Base 설정 + 켜진 add-on 이 기여한 설정 (addon-host/contributions) */
export const SYSTEM_SETTINGS_REGISTRY: SystemSettingDef[] = [
    ...BASE_SYSTEM_SETTINGS,
    ...contributedSettings().map((d) => {
        const { allowedValues: _allowedValues, ...def } = d;
        return { ...def, validate: contributedValidator(d) };
    }),
];

export const SETTING_DEFS_BY_KEY: ReadonlyMap<string, SystemSettingDef> = new Map(
    SYSTEM_SETTINGS_REGISTRY.map((def) => [def.key, def]),
);
