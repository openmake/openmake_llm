-- 196 되돌리기 — add-on 도구 의도 중립 열 제거. 구 열 discussion_intent(086)의 값은 그대로 남는다.
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 모른다).
-- 새 코드가 도는 동안 이 파일만 적용하면 셰도우 INSERT 가 실패하지만 fire-and-forget 이라 채팅은 막히지 않고 경고만 남는다.
ALTER TABLE orchestration_dispatch_decisions DROP COLUMN IF EXISTS addon_tool_intent;
