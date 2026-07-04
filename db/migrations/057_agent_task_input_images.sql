-- 057: Agent Task 입력 첨부 이미지 (vision 채널 전달)
--
-- 채팅 composer 에서 에이전트 모드로 첨부한 이미지(dataURL)를 작업에 전달하기 위한 컬럼.
-- 실행 시 goal 메시지의 vision 채널(images)로 주입하고, 샌드박스 ON 이면 uploads/ 에
-- 원본 바이트로도 기록한다. 멱등(ADD COLUMN IF NOT EXISTS). 수동 적용(cli.ts migrate).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS input_images JSONB;

COMMENT ON COLUMN agent_tasks.input_images IS '작업 생성 시 첨부된 입력 이미지(dataURL 배열). vision 주입 + 샌드박스 기록용.';
