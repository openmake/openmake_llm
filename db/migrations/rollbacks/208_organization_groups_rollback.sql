-- 208 되돌리기 — 209(확장 배포 모드)를 먼저 되돌린 뒤 실행한다(extension_org_group_modes 가 그룹을 참조한다).
-- ⚠️ 그룹과 그룹 멤버십이 함께 지워진다.
DROP TABLE IF EXISTS organization_group_members;
DROP TABLE IF EXISTS organization_groups;
