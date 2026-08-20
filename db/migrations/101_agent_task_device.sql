-- 101: 로컬 실행 대상 브리지 디바이스 영속 (다중 디바이스, 2026-08-21)
-- executor='local' 작업이 어느 디바이스(데스크톱/CLI)로 라우팅되는지 기록 —
-- 다대 접속 시 도구 위임의 결정적 라우팅 + 상세/뱃지 노출용. 미지정(NULL)은 최근 접속 폴백.
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS device_id TEXT;
