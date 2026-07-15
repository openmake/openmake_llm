-- Migration 074 — conversation_messages.reasoning_summary (생각 요약 헤드라인 영속화)
--
-- 클로드 웹식 thinking 표시 후속 (2026-07-15): 생각 과정(기존 thinking 컬럼 재사용)과
-- 요약 헤드라인을 assistant 메시지에 저장해, 세션 재열람 시에도 타임라인을 표시한다.
-- thinking 컬럼은 Ollama 시절부터 존재(미사용) — 이번에 실사용 재개.

ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS reasoning_summary TEXT;

COMMENT ON COLUMN conversation_messages.reasoning_summary IS
    '생각 요약 헤드라인 — summary role 모델 생성 (thinking-summarizer). NULL=요약 없음.';
COMMENT ON COLUMN conversation_messages.thinking IS
    '생각(추론) 원문 — thinkingMode 스트림 누적본. 재열람 시 타임라인 표시에 사용.';
