-- P1 보고서 파이프라인 Phase 3: reportdata 원본(JSON) 보존.
-- 보고서 아티팩트는 렌더된 HTML(content)과 별개로 구조화 원본을 보관해,
-- docx 등 비-HTML 포맷 export 를 구조 데이터에서 직접 생성한다 (html→docx 변환보다 고품질).
-- 일반 아티팩트는 NULL — 스토리지 영향 없음.
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS source_data JSONB;
