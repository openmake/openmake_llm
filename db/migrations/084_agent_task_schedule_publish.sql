-- 084: 예약 task 산출물 자동 게시 슬러그
--
-- 예약(무인) task 는 채팅 세션이 없어 아티팩트로도, 목록으로도 사용자에게 도달하지 않는다.
-- publish_slug 가 설정된 스케줄은 완료 시 workspace 산출물을 정적 공개 경로로 복사해
-- 매일 같은 URL(.../<slug>/latest.html)에서 열람할 수 있게 한다. NULL 이면 게시하지 않음.
ALTER TABLE agent_task_schedules ADD COLUMN IF NOT EXISTS publish_slug TEXT;
