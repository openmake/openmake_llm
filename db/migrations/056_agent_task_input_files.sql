-- 056: Agent Task 입력 첨부 파일 (업로드 자료 → 작업 전달)
--
-- 채팅 composer 에서 에이전트 모드로 첨부한 파일을 작업에 전달하기 위한 컬럼.
-- 생성 시 doc-extractor 로 텍스트 추출된 [{name,type,content,size,truncated,extracted}] 를 보관하고,
-- 실행 시 샌드박스 workspace(uploads/)에 기록하거나(샌드박스 ON) fileContext 로 주입(OFF).
-- 멱등(ADD COLUMN IF NOT EXISTS). 수동 적용(cli.ts migrate).

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS input_files JSONB;

COMMENT ON COLUMN agent_tasks.input_files IS '작업 생성 시 첨부된 입력 파일(추출 텍스트). [{name,type,content,size,truncated,extracted}]';
