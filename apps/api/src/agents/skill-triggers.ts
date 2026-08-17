/**
 * @module agents/skill-triggers
 * @description
 * 스킬 `triggers` 파싱·매칭 순수 함수 모음 (LLM 호출 없음).
 *
 * 개인 지정 스킬(manifest id `user-` prefix)은 카테고리 필터를 우회해 모든 대화에
 * 주입되므로, 스킬 하나가 무관한 질의까지 자기 워크플로우로 끌어가는 오염이 생긴다 —
 * 발표자료 스킬이 클라우드 비교 질문의 답을 슬라이드 아티팩트로 만들어버린 실측
 * 사례(2026-08-18). 여기 함수들이 그 주입 게이트를 담당한다.
 */

/** triggers 활성화에 사용할 노출 상한 (프롬프트 비대화 방지) */
const SKILL_TRIGGER_HINT_MAX = Number(process.env.SKILL_TRIGGER_HINT_MAX) || 8;

/**
 * manifestMeta.triggers 를 스킬 블록에 넣을 "적용 상황" 힌트 문자열로 변환.
 * triggers 가 없거나 비면 빈 문자열(기존 동작과 동일).
 *
 * @param manifestMeta - 스킬 manifest 메타 (triggers 배열 보유 가능)
 * @returns " (적용 상황: a, b, c)" 형태 또는 ''
 */
export function formatTriggerHint(manifestMeta?: Record<string, unknown>): string {
    const triggers = readMetaTriggers(manifestMeta)
        .map(t => t.replace(/[<>"&]/g, ''))
        .slice(0, SKILL_TRIGGER_HINT_MAX);
    if (triggers.length === 0) return '';
    return ` (적용 상황: ${triggers.join(', ')})`;
}

/**
 * manifest yaml 의 `triggers:` 블록을 문자열 배열로 파싱.
 * 저장된 manifest_yaml 은 fence 없는 순수 yaml 이라 최상위 키를 multiline 으로 매칭한다.
 *
 * 지원 형태:
 *   triggers: [발표자료, 슬라이드]
 *   triggers:
 *     - 발표자료
 *     - "슬라이드"
 */
export function parseManifestTriggers(manifestYaml: string): string[] {
    const inline = /^triggers:\s*\[([^\]]*)\]\s*$/m.exec(manifestYaml);
    if (inline) {
        return inline[1].split(',')
            .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
    }
    const block = /^triggers:\s*\n((?:\s*-\s*[^\n]+\n?)+)/m.exec(manifestYaml);
    if (!block) return [];
    return block[1].split('\n')
        .map(line => /^\s*-\s*(.+)$/.exec(line)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '')
        .filter(Boolean);
}

/** manifestMeta(JSON) 의 triggers 배열에서 유효 문자열만 추린다. */
export function readMetaTriggers(manifestMeta?: Record<string, unknown>): string[] {
    const raw = manifestMeta?.triggers;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(t => t.trim());
}

/**
 * 스킬 주입 관련성 게이트.
 *
 * 스킬이 `triggers` 를 **선언한 경우에만** 게이트한다. 미선언 스킬은 종전대로 항상
 * 주입해 기존 배포에 회귀가 없다. 트리거는 대소문자 무관 부분일치.
 *
 * @param triggers - 스킬이 선언한 적용 상황 키워드
 * @param query - 이번 턴의 사용자 질의 (없으면 게이트하지 않음 — 판단 근거 부재)
 */
export function matchesSkillTriggers(triggers: string[], query?: string): boolean {
    if (triggers.length === 0) return true;
    if (!query || query.trim().length === 0) return true;
    const haystack = query.toLowerCase();
    return triggers.some(t => {
        const needle = t.toLowerCase().trim();
        return needle.length > 0 && haystack.includes(needle);
    });
}
