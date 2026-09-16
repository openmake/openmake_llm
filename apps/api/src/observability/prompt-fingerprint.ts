/**
 * 요청별 프롬프트·도구 "버전" = 결정적 지문 (F24.2) — PURE.
 *
 * 시스템 프롬프트는 코드·config 로 조립되므로 템플릿 버전 번호가 없다. 대신 조립 결과를 sha256 으로 남겨
 * "이 응답이 어떤 프롬프트/도구 조합으로 나왔는가" 를 식별한다. 정적 prefix 지문은 prefix cache 안정성 관측과 직결된다 —
 * 같은 스타일·언어 조합인데 정적 지문이 요청마다 바뀌면 가변 문자열이 정적 구간에 섞인 것이다.
 *
 * @module observability/prompt-fingerprint
 */
import { createHash } from 'crypto';

export function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface PromptFingerprint {
    staticHash: string;
    fullHash: string;
    /** 복원용 원문 — 정적 prefix 만(가변 블록은 사용자 정보가 섞여 저장하지 않는다) */
    staticText: string;
}

/** 조립과 같은 구분자('\n\n')로 이어 붙인 문자열의 지문. */
export function fingerprintPrompt(staticParts: readonly string[], dynamicParts: readonly string[]): PromptFingerprint {
    const staticText = staticParts.join('\n\n');
    return { staticHash: sha256(staticText), fullHash: sha256([...staticParts, ...dynamicParts].join('\n\n')), staticText };
}

/** 이번 요청에 실린 블록 이름 — 존재 여부만(내용 없음). */
export function promptBlockNames(ctx: {
    style?: string; answerFormatBlock?: string; artifactGuideBlock?: string; reportGuideBlock?: string;
    agentSystemMessage?: string; memoryBlock?: string; customInstructionsBlock?: string;
}, flags: { webSearch?: boolean; location?: boolean; map?: boolean; orchestration?: boolean; spawn?: boolean }): string[] {
    const table: Array<[string, unknown]> = [
        ['style', ctx.style && ctx.style !== 'default'], ['answerFormat', ctx.answerFormatBlock], ['artifact', ctx.artifactGuideBlock],
        ['report', ctx.reportGuideBlock], ['agent', ctx.agentSystemMessage], ['memory', ctx.memoryBlock], ['custom', ctx.customInstructionsBlock],
        ['webSearch', flags.webSearch], ['location', flags.location], ['map', flags.map], ['orchestration', flags.orchestration], ['spawn', flags.spawn],
    ];
    return table.filter(([, v]) => !!v).map(([k]) => k);
}

export interface ToolManifestFingerprint {
    hash: string;
    names: string[];
    /** 복원용 원문 — 이름순 정렬한 name+parameters JSON */
    manifestJson: string;
}

/** 도구 목록 지문 — 이름순 정렬(노출 순서가 바뀌어도 같은 도구 집합이면 같은 지문), 설명은 제외하지 않고 스키마만. */
export function fingerprintTools(tools: ReadonlyArray<{ function: { name: string; parameters?: unknown } }>): ToolManifestFingerprint {
    const sorted = [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name));
    const manifestJson = JSON.stringify(sorted.map((t) => ({ name: t.function.name, parameters: t.function.parameters ?? null })));
    return { hash: sha256(manifestJson), names: sorted.map((t) => t.function.name), manifestJson };
}
