/**
 * 딥리서치 결과 포맷 — 종전 services/chat-service-formatters.ts 에서 옮겼다(2026-09-19).
 *
 * @module addons/deep-research/format
 */

/**
 * 심층 연구 결과를 마크다운 형식으로 포맷팅합니다.
 *
 * 종합 요약, 주요 발견사항, 참고 자료를 구조화된 마크다운으로 변환합니다.
 *
 * @param result - 연구 결과 객체
 * @param result.topic - 연구 주제
 * @param result.summary - 종합 요약
 * @param result.keyFindings - 주요 발견사항 목록
 * @param result.sources - 참고 자료 (제목 + URL)
 * @param result.totalSteps - 총 연구 단계 수
 * @param result.duration - 총 소요 시간 (밀리초)
 * @returns 마크다운 형식의 연구 보고서 문자열
 */
export function formatResearchResult(result: {
    topic: string;
    summary: string;
    keyFindings: string[];
    sources: Array<{ title: string; url: string }>;
    totalSteps: number;
    duration: number;
}): string {
    // result.summary 는 report-generator 가 만든 **완전한 보고서**(제목·종합요약·주요발견·상세분석·
    // 참고문헌 포함). 과거엔 이를 "종합 요약"에 통째로 넣고 keyFindings/sources 를 또 붙여 삼중
    // 중복(+ raw URL 참고문헌)이 됐다. 이제 보고서를 그대로 출력하고 메타 라인만 덧붙인다.
    const meta = `*총 ${result.totalSteps}단계 연구, ${result.sources.length}개 소스 분석, ${(result.duration / 1000).toFixed(1)}초 소요*`;
    return `${(result.summary || '').trim()}\n\n---\n${meta}`;
}
