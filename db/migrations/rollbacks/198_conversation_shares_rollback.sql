-- 198 되돌리기 1단계 — 접근 차단만 한다. 공유 행·snapshot·감사 기록은 보존한다(데이터 손실 없음).
--
-- 순서: ① 대화 공유를 쓰지 않는 이전 코드로 배포 → ② 이 파일로 모든 공유를 private 로 막고 미리보기·trigger 제거.
-- 이전 코드는 이 표들을 모르므로 ②가 없어도 공유는 열리지 않는다. ②는 다음 버전 재배포 전까지 노출을 확실히 막는 단계다.
-- 198 을 다시 적용하면 trigger 가 복구된다(공유는 private 로 남는다 — 다시 게시해야 공개된다).
--
-- 2단계(표 삭제)는 이 파일에 넣지 않는다. snapshot·감사 보존을 확인한 뒤 별도 승인으로 수동 실행한다:
--   DROP TABLE IF EXISTS conversation_share_previews;
--   DROP TABLE IF EXISTS conversation_shares;
-- 운영에서 데이터 손실 rollback 을 자동 실행하지 않는다.

UPDATE conversation_shares
   SET visibility = 'private', org_id = NULL, share_token = NULL, revision = revision + 1, updated_at = NOW()
 WHERE visibility <> 'private';

DELETE FROM conversation_share_previews;

DROP TRIGGER IF EXISTS trg_conversation_share_member_removed ON organization_members;
DROP TRIGGER IF EXISTS trg_conversation_share_organization_deleted ON organizations;
DROP FUNCTION IF EXISTS conversation_share_on_member_removed();
DROP FUNCTION IF EXISTS conversation_share_on_organization_deleted();
