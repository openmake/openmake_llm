-- 102: 로컬 실행 대상 폴더 영속 (브리지 폴더 선택, 2026-08-21)
-- executor='local' 작업이 연결 루트의 어느 하위 폴더를 cwd 로 실행되는지 기록 —
-- 도구 위임 시 bridge 요청의 folder 값 + 상세/뱃지 노출용. NULL 은 연결 루트(현행 동작).
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS folder_rel TEXT;
