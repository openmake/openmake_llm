/**
 * @module addons/skill-runtime/skill-triggers
 * @description
 * 스킬 주입 관련성 게이트 — manifest 형식 파싱은 Base(`agents/manifest-triggers`)가 하고,
 * 여기서는 그 값으로 이번 턴에 주입할지 판단한다 (LLM 호출 없음).
 *
 * 개인 지정 스킬(manifest id `user-` prefix)은 카테고리 필터를 우회해 모든 대화에 주입되므로,
 * 스킬 하나가 무관한 질의까지 자기 워크플로우로 끌어가는 오염이 생긴다 — 발표자료 스킬이
 * 클라우드 비교 질문의 답을 슬라이드 아티팩트로 만들어버린 실측 사례(2026-08-18).
 */
export { formatTriggerHint, parseManifestTriggers, readMetaTriggers } from '../../agents/manifest-triggers';

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
