/**
 * manifest 스킬 주입 계획 (순수) — skill-manager.buildManifestPrompt 가 사용.
 *
 * 합계 상한(SKILL_MANIFEST_INJECT_MAX_CHARS)을 넘으면 종전엔 페르소나 → priority → id 순으로 담다가
 * 나머지를 건너뛰었다. "관련도 높은 스킬 하나를 온전히" 가 의도였지만 실제 선택 기준은 id 순이었다
 * (백엔드 질문에 트리거된 postgres-patterns·karpathy 가 id 순에 밀려 빠지는 식). offerOnOverflow 면
 * 넘친 턴에는 페르소나만 싣고 나머지 후보를 목록으로 넘겨, 무엇을 불러올지 모델이 같은 턴에
 * load_skill 로 판단한다 (판단 경계 B형 — 앞단 LLM 호출 없음, triggers 가 프리필터).
 *
 * @module agents/manifest-injection-plan
 */
import { buildSkillOfferBlock } from '../prompts/skill-offer';
import { SKILL_CATALOG_DESC_MAX } from './skill-catalog';

export interface PlanRow {
    id: string;
    assigned_to: string;
    prompt_md: string;
}

export interface ManifestInjectionPlan<T extends PlanRow> {
    /** 본문을 싣는 행 — prompt_md 는 개별 상한으로 잘린 값 */
    injected: T[];
    /** 결정적 규칙에서 합계 상한에 밀린 행 */
    skipped: T[];
    /** 모델 선택 모드에서 목록으로만 넘기는 행 — prompt_md 원본 유지 */
    offered: T[];
    injectedChars: number;
}

export interface PlanOptions<T extends PlanRow> {
    maxChars: number;
    perSkillMaxChars: number;
    /** 모델이 load_skill 로 불러올 수 있을 때만 true — 아니면 종전 결정적 규칙 */
    offerOnOverflow: boolean;
    isPersona: (row: T) => boolean;
}

function clip<T extends PlanRow>(row: T, max: number): T {
    return row.prompt_md.length > max ? { ...row, prompt_md: `${row.prompt_md.slice(0, max)}\n... (truncated)` } : row;
}

export function planManifestInjection<T extends PlanRow>(rows: readonly T[], opts: PlanOptions<T>): ManifestInjectionPlan<T> {
    // 페르소나(작음)가 먼저 — 상한에 밀리지 않게. 나머지는 입력 순서(priority → id) 유지.
    const personas = rows.filter((r) => opts.isPersona(r));
    const others = rows.filter((r) => !opts.isPersona(r));
    const ordered = [...personas, ...others].map((r) => clip(r, opts.perSkillMaxChars));
    const total = ordered.reduce((sum, r) => sum + r.prompt_md.length, 0);

    if (opts.offerOnOverflow && others.length > 0 && total > opts.maxChars) {
        const injected = personas.map((r) => clip(r, opts.perSkillMaxChars));
        return { injected, skipped: [], offered: others, injectedChars: injected.reduce((sum, r) => sum + r.prompt_md.length, 0) };
    }

    // 종전 결정적 규칙 — 첫 행은 상한과 무관하게 싣고, 넘치는 뒤쪽은 건너뛴다
    const injected: T[] = [];
    const skipped: T[] = [];
    let injectedChars = 0;
    for (const r of ordered) {
        if (injected.length > 0 && injectedChars + r.prompt_md.length > opts.maxChars) { skipped.push(r); continue; }
        injected.push(r);
        injectedChars += r.prompt_md.length;
    }
    return { injected, skipped, offered: [], injectedChars };
}

/** manifest_yaml 최상위 스칼라 키 값(name·description 등) — fence 유무 무관 */
export function manifestYamlField(yaml: string, key: string): string | undefined {
    const m = new RegExp(`^${key}:\\s*([^\\n]+)`, 'm').exec(yaml);
    return m?.[1]?.trim().replace(/^['"]|['"]$/g, '') || undefined;
}

/** 모델 선택 모드의 후보 목록 블록 — manifest 의 name·description(카탈로그와 같은 길이 상한)과 원본 크기 */
export function buildManifestOfferBlock(offered: ReadonlyArray<PlanRow & { manifest_yaml: string }>): string {
    return buildSkillOfferBlock(offered.map((r) => ({
        name: manifestYamlField(r.manifest_yaml, 'name') || r.id,
        description: (manifestYamlField(r.manifest_yaml, 'description') ?? '').slice(0, SKILL_CATALOG_DESC_MAX),
        chars: r.prompt_md.length,
    })));
}
