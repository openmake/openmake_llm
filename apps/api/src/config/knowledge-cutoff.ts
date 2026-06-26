/**
 * 모델 학습 지식 컷오프 — 프롬프트에 명시할 "학습 기준일" 라벨.
 *
 * 컷오프는 LLM_DEFAULT_MODEL(qwen3.6 등)·외부 provider 에 종속된 모델별 사실이므로,
 * 프롬프트 문자열에 인라인 하드코딩하지 않고 여기서 단일 소스로 관리한다(No-Hardcoding L2).
 * 기본 모델/외부 provider 교체 시 LLM_KNOWLEDGE_CUTOFF_* env 로 배포 없이 조정.
 *
 * @module config/knowledge-cutoff
 */

/** 언어별 학습 컷오프 표기 (프롬프트 본문 삽입용 자연어 라벨). */
export const KNOWLEDGE_CUTOFF: Record<'ko' | 'en', string> = {
    ko: process.env.LLM_KNOWLEDGE_CUTOFF_KO || '2024년 12월',
    en: process.env.LLM_KNOWLEDGE_CUTOFF_EN || 'December 2024',
};
