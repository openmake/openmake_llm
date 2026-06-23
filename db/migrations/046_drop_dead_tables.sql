-- 046: 데드 테이블 제거 (RAG/MemoryService 폐기 잔재)
-- 1단계(코드 참조 제거: legacy-schema CREATE + db-retention 정리)는 같은 PR 에서 완료.
-- 이 DROP 은 코드 배포 후 수동 적용: `npx ts-node apps/api/src/data/migrations/cli.ts migrate`
-- (migrations/ 는 부팅 자동적용 아님)
--
-- uploaded_documents: RAG/문서처리 폐기로 writer 0 (항상 0행). retention 참조 제거됨.
-- memory_tags: MemoryService 폐기로 코드 참조 0 (고아 데이터). user_memories 로의 FK 측이라
--              DROP 이 user_memories(live) 에 영향 없음.
DROP TABLE IF EXISTS memory_tags CASCADE;
DROP TABLE IF EXISTS uploaded_documents CASCADE;
