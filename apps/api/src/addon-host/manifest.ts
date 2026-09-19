/**
 * Add-on 매니페스트 `openmake-addon.json` — 설치·활성화 단위의 신원과 호환 범위 (Add-on 전환 P2, 2026-09-18).
 *
 * 지금 소비처는 내장 팩 부팅 검증뿐이다. 구성요소(skills·mcp·agents) 해석은 기존 Agent Plugins v1 경로
 * (`agents/git-ingest/extension-manifest-validator.ts` 의 plugin.json)가 맡고, 이 파일은 그 위에 얹는
 * 식별·호환·범위 축만 정의한다. `server`·`ui` 구성요소는 받지 않는다 — 설치형의 인프로세스 코드 로딩은
 * 열지 않았다(strict 로 거절). `migrations` 는 2026-09-19 부터 받는다(add-on 전용 스키마, 네임스페이스 분리).
 *
 * @module addon-host/manifest
 */
import { z } from 'zod';

export const ADDON_MANIFEST_FILENAME = 'openmake-addon.json';

const ADDON_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

export const ADDON_SCOPES = ['system', 'organization', 'user'] as const;
export const ADDON_KINDS = ['content', 'integration', 'runtime'] as const;

/**
 * 코드 진입점 참조 — `<모듈 경로>#<export 이름>`(export 생략 시 default). 모듈 경로는 add-on 코드 디렉토리
 * (`src/addons/<id>/`) 기준이고 소문자·숫자·하이픈·점으로 된 세그먼트만 받는다(`..`·절대 경로 불가).
 * ⚠️ **레포에 코드가 있는 내장 add-on 전용**이다 — 설치형 확장의 매니페스트에 있으면 설치를 거절한다
 * (인프로세스 코드 로딩은 열지 않았다, 아래 `validateInstallableAddonManifest`).
 */
const entryRefSchema = z.string().max(200).regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*(\/[a-z0-9-]+(\.[a-z0-9-]+)*)*(#[A-Za-z_][A-Za-z0-9_]*)?$/);

const addonEntrySchema = z.object({
    /**
     * 런타임 구현 등록 — Base 포트(`runtime-ports/*`)에 구현을 꽂는 부팅 함수(`() => Promise<void>`).
     * 호스트가 팩 설치보다 **먼저** 부른다(스킬·도구 런타임이 서야 그 뒤 단계가 의미를 갖는다).
     */
    runtime: entryRefSchema.optional(),
    /** 채팅 턴 통합 (services/chat-service/turn-integrations.ts `ChatTurnIntegration`) */
    chatIntegration: entryRefSchema.optional(),
    /** 채팅 모드 (services/chat-service/chat-modes.ts `ChatModeExtension`) */
    chatMode: entryRefSchema.optional(),
    /** 설정·API key 스코프·도구 위험 등급 기여 (addon-host/contributions.ts `AddonContribution`) */
    contributions: entryRefSchema.optional(),
    /** 전용 라우트 — `within: 'v1'` 은 v1 라우터(API 키 인증·스코프·rate limit 뒤) 안에 건다 */
    routes: z.array(z.object({
        mountPath: z.string().min(1).max(200).regex(/^\/[A-Za-z0-9/_-]*$/),
        module: entryRefSchema,
        within: z.enum(['v1']).optional(),
    }).strict()).max(20).optional(),
}).strict();

export const addonManifestSchema = z.object({
    id: z.string().min(1).max(120).regex(ADDON_ID_PATTERN),
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(40),
    description: z.string().max(500).optional(),
    requires: z.object({
        openmake: z.string().min(1).max(80),
        /**
         * 이 add-on 이 제대로 도는 데 필요한 **모델 역량** (2026-09-19, S3). 모델 프로필
         * (`config/model-profiles.ts`)과 정적으로 대조한다 — 턴마다 LLM 에게 묻지 않는다(A형 금지).
         * 미충족이면 부팅 로그·관리자 화면이 충족 후보를 안내하고, 후보가 없으면 명시적으로 알린다.
         */
        model: z.object({
            /** 최소 컨텍스트 토큰 */
            minContext: z.number().int().min(1).max(10_000_000).optional(),
            /** 도구 호출 필요 */
            tools: z.boolean().optional(),
            /** 비전(이미지 입력) 필요 */
            vision: z.boolean().optional(),
        }).strict().optional(),
    }),
    scope: z.enum(ADDON_SCOPES),
    /**
     * content = 스킬·에이전트 정의를 싣는 팩, integration = 코드가 레포에 있는 통합 기능,
     * runtime = Base 포트에 구현을 꽂는 실행 런타임(스킬·도구). 생략하면 content
     */
    kind: z.enum(ADDON_KINDS).optional(),
    /** 로드 순서(작을수록 먼저) — "첫 건이 이기는" 확장점(첫 턴 도구 강제·모드 선점)의 우선순위. 같으면 id 순 */
    order: z.number().int().min(0).max(100000).optional(),
    /**
     * 이 add-on 이 소유한 시스템 스킬의 `source_path` LIKE 패턴 — 끄면 여기 걸리는 시스템 스킬을 보관한다.
     * `skills.json` 의 `sourcePath` 와 짝(`pack-skills.test.ts` 가 확인). ⚠️ id 접두사(`system-skill-`)로 고르지 말 것 —
     * Base 스킬(general·author-guide)과 수동 등록 시스템 스킬이 같은 접두사를 쓴다.
     */
    skillSourcePath: z.string().min(3).max(200).optional(),
    components: z.object({
        skills: z.string().optional(),
        agents: z.string().optional(),
        mcp: z.string().optional(),
        /** MCP 카탈로그 템플릿 목록 JSON (addon-host/pack-catalog.ts) */
        mcpCatalog: z.string().optional(),
        data: z.string().optional(),
        /** 에이전트 id → 키워드 라우팅 어휘 텍스트 JSON (agents/enhanced-keywords.ts) */
        routingVocabulary: z.string().optional(),
        /**
         * 이 add-on 전용 스키마의 마이그레이션 디렉토리(기본 `./migrations`) — 켜졌을 때만 적용되고
         * `migration_versions.version` 은 `addon:<id>:NNN` 네임스페이스를 쓴다 (2026-09-19, §10-5).
         * add-on 이 설치되지 않은 DB 에는 그 테이블이 아예 없다. **코어 테이블은 여기 두지 않는다.**
         */
        migrations: z.string().optional(),
    }).strict(),
    entry: addonEntrySchema.optional(),
    permissions: z.array(z.string().min(1).max(80)).max(50).optional(),
    entitlement: z.object({ sku: z.string().min(1).max(120) }).optional(),
}).strict();

export type AddonManifest = z.infer<typeof addonManifestSchema>;

/**
 * 설치형 확장(Git·ZIP·마켓플레이스)에 동봉된 `openmake-addon.json` 검증 — 내장 add-on 과 **같은 계약**을 쓴다.
 * 구성요소 해석은 기존 plugin.json 경로가 그대로 맡고, 여기서는 호환 범위와 설치형에 허용되지 않는 선언만 본다:
 * 코드 진입점(`entry`)과 system 범위는 레포에 코드가 있는 내장 add-on 만 가질 수 있다. 반환값은 거절 사유(빈 배열 = 통과).
 */
export function validateInstallableAddonManifest(jsonText: string, appVersion: string): string[] {
    let raw: unknown;
    try { raw = JSON.parse(jsonText); } catch { return ['JSON 파싱 실패']; }
    const parsed = addonManifestSchema.safeParse(raw);
    if (!parsed.success) return parsed.error.issues.map(i => `${i.path.join('.') || '(root)'} ${i.message}`);
    const errors: string[] = [];
    if (parsed.data.entry) errors.push('entry: 설치형 add-on 은 인프로세스 코드 진입점을 선언할 수 없다 (코드 확장은 MCP 서버로)');
    if (parsed.data.scope === 'system') errors.push('scope: 설치형 add-on 은 system 범위를 가질 수 없다');
    if (!satisfiesOpenmakeRange(appVersion, parsed.data.requires.openmake)) {
        errors.push(`requires.openmake: 현재 버전 ${appVersion} 이 요구 범위 '${parsed.data.requires.openmake}' 밖`);
    }
    return errors;
}

/**
 * `requires.openmake` 범위 판정 — `>=a.b.c <x.y.z` 형태의 비교식 나열만 지원한다(semver 라이브러리 미도입).
 * 해석할 수 없는 식은 불충족으로 본다(조용히 통과시키지 않는다).
 */
export function satisfiesOpenmakeRange(version: string, range: string): boolean {
    const toNums = (v: string): number[] | null => {
        const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const cmp = (a: number[], b: number[]): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    const current = toNums(version);
    if (!current) return false;
    const tests: Readonly<Record<string, (c: number) => boolean>> = {
        '>=': c => c >= 0, '>': c => c > 0, '<=': c => c <= 0, '<': c => c < 0, '=': c => c === 0,
    };
    const parts = range.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every(part => {
        const m = /^(>=|<=|>|<|=)(\d+\.\d+\.\d+)$/.exec(part);
        const bound = m ? toNums(m[2]) : null;
        return !!m && !!bound && tests[m[1]](cmp(current, bound));
    });
}
