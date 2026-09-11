-- Rollback 120 — modality_models 재생성 + capability_models 에서 역이관 (117 스키마 그대로)
CREATE TABLE IF NOT EXISTS modality_models (
    scope       TEXT NOT NULL,
    modality    TEXT NOT NULL CHECK (modality IN ('image_gen', 'image_edit', 'vision', 'video_gen', 'stt', 'tts', 'embedding')),
    full_id     TEXT NOT NULL,
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, modality)
);
CREATE INDEX IF NOT EXISTS idx_modality_models_scope ON modality_models (scope);
INSERT INTO modality_models (scope, modality, full_id, params, created_at, updated_at)
SELECT scope,
       CASE capability
           WHEN 'image.generate'   THEN 'image_gen'
           WHEN 'image.edit'       THEN 'image_edit'
           WHEN 'vision.describe'  THEN 'vision'
           WHEN 'video.generate'   THEN 'video_gen'
           WHEN 'audio.transcribe' THEN 'stt'
           WHEN 'audio.speech'     THEN 'tts'
           WHEN 'text.embed'       THEN 'embedding'
       END,
       full_id, params, created_at, updated_at
FROM capability_models
WHERE capability IN ('image.generate','image.edit','vision.describe','video.generate','audio.transcribe','audio.speech','text.embed')
ON CONFLICT (scope, modality) DO NOTHING;
