-- ============================================================
-- 020_drop_memory_documents.sql — MemoryService + 문서 처리 스키마 정리
-- ============================================================
--
-- MemoryService(user_memories) 와 문서 처리(uploaded_documents) 인프라가
-- 2026-05-19 에 코드 레벨에서 완전히 제거됐다.
--   - services/MemoryService.ts, data/repositories/memory-repository.ts
--   - documents/{processor,store,progress,index}.ts
--   - routes/{memory,documents}.routes.ts
--   - schemas/{memory,documents}.schema.ts
--   - 관련 frontend 페이지 (memory.html, documents.html) + 모듈
--
-- 운영 DB 에 잔존하는 테이블/인덱스를 cleanup 한다.
--
-- 안전성:
--   - DROP TABLE IF EXISTS → 테이블 부재 시 no-op
--   - 운영 데이터 (작성 시점):
--       * uploaded_documents       : 0 행 (TTL 1시간이라 휘발성)
--       * user_memories            : 6 행 (사용자 데이터 영구 손실)
--     → 사용자가 명시적으로 "모두 제거 (6행 영구 손실)" 옵션 선택 후 적용.
--   - FK / 인덱스 / 트리거 / 코멘트 등 종속 객체는 CASCADE 로 정리.
--
-- 복구 (필요 시): 신규 RAG / 메모리 인프라 도입 시 새 스키마 설계 권장.
--                이전 user_memories 데이터는 복구 불가.
--
-- @see commits 2026-05-19 (MemoryService + 문서 처리 코드 제거)
-- ============================================================

DROP TABLE IF EXISTS user_memories CASCADE;
DROP TABLE IF EXISTS uploaded_documents CASCADE;
