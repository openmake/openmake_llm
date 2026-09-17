-- 156: 웹검색 출처를 assistant 메시지 행에 영속 (2026-09-17, F19.4) — 인용 [N] 미리보기·재로드용
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS sources JSONB;
COMMENT ON COLUMN conversation_messages.sources IS '[{n,title,url,snippet,source?}] — formatSearchSources 와 같은 순서·캡(156)';
