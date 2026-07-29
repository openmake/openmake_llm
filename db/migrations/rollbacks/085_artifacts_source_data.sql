-- 085 롤백: source_data 컬럼 제거 (애플리케이션 코드 참조 제거 후 적용 — 2단계 배포 원칙)
ALTER TABLE artifacts DROP COLUMN IF EXISTS source_data;
