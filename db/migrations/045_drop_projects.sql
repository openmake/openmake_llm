-- 045: projects 기능 제거 (2단계 배포 2단계)
-- 1단계(애플리케이션 코드 참조 제거)는 이 마이그레이션과 같은 PR 에서 완료됨.
-- 이 DROP 은 코드 배포 후 수동 적용한다: `npx ts-node apps/api/src/data/migrations/cli.ts migrate`
-- (migrations/ 는 부팅 시 자동 적용되지 않음.)
DROP TABLE IF EXISTS projects CASCADE;
