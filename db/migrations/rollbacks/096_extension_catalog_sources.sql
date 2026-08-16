-- Rollback 096 — extension_catalog_sources 제거
--
-- ⚠️ 애플리케이션 코드 참조 제거 후 실행할 것 (2단계 배포 원칙).

DROP TABLE IF EXISTS extension_catalog_sources;
