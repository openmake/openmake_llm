-- 209 되돌리기 — 코드 참조(extension-org-deployment 저장소·조정 잡)를 먼저 걷어낸 뒤 실행한다.
-- ⚠️ 배포 모드·그룹 덮어쓰기·멤버 설치 기록이 지워진다. 이미 설치된 멤버의 확장(user_extensions 행)은 남는다.
DROP TABLE IF EXISTS extension_org_member_installs;
DROP TABLE IF EXISTS extension_org_group_modes;
DROP TABLE IF EXISTS extension_org_deployments;
