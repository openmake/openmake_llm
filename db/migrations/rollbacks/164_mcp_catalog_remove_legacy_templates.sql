-- 164 롤백 — 삭제한 템플릿은 원 시드 마이그레이션의 INSERT 로만 되살릴 수 있다(내용이 여러 파일에 걸쳐 보정됐다):
--   028_mcp_catalog_seed.sql → 051(postgres 인자) · 052(github 토큰 env) · 058(fetch uvx) · 122(버전 상향)
-- 의도적으로 자동 복원 SQL 을 두지 않는다 — 폐기 사유(비밀값 CLI 인자 등)가 그대로 돌아온다.
SELECT 1;
