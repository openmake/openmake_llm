-- Rollback 111 — 백필로 만든 manifest 만 제거 (signature 마커 기준)
DELETE FROM skill_manifests WHERE signature = 'backfill-111';
