-- Migration 118 — capability_models 테이블 + modality_models 행 이관
--
-- 멀티모달 오케스트레이터(2026-09-12 설계, docs/proposals/2026-09-12-multimodal-orchestrator-design.md).
-- "어떤 기능(capability)을 어느 모델이 처리하는가" — Planner(LLM)는 capability 이름만 내고 모델은 이 표가 정한다.
-- 구 modality_models(117)의 일반화: scope('__global__'|user_id)·full_id 규약 동일, 이름만 점 표기 capability.
--
-- capability CHECK 는 코드 SoT(config/capabilities.ts CAPABILITIES)와 정합 유지할 것.
-- modality_models 는 2단계 규칙대로 이 배포에서 참조만 제거하고 다음 배포에서 DROP 한다.

CREATE TABLE IF NOT EXISTS capability_models (
    scope       TEXT NOT NULL,
    capability  TEXT NOT NULL CHECK (capability IN (
        'text.reason', 'text.code', 'text.synthesize', 'text.embed',
        'vision.describe', 'vision.ocr',
        'image.generate', 'image.edit',
        'audio.transcribe', 'audio.speech', 'audio.analyze',
        'music.analyze', 'music.generate',
        'video.generate', 'video.analyze',
        'web.search'
    )),
    full_id     TEXT NOT NULL,
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, capability)
);

COMMENT ON TABLE capability_models IS
    'capability→모델 배정(멀티모달 오케스트레이터). scope=''__global__'' 또는 user_id. 해석은 services/orchestrator/capability-resolver.';

CREATE INDEX IF NOT EXISTS idx_capability_models_scope ON capability_models (scope);

-- 구 모달리티 행 이관 (멱등 — 이미 있으면 건너뜀)
INSERT INTO capability_models (scope, capability, full_id, params, created_at, updated_at)
SELECT m.scope,
       CASE m.modality
           WHEN 'image_gen'  THEN 'image.generate'
           WHEN 'image_edit' THEN 'image.edit'
           WHEN 'vision'     THEN 'vision.describe'
           WHEN 'video_gen'  THEN 'video.generate'
           WHEN 'stt'        THEN 'audio.transcribe'
           WHEN 'tts'        THEN 'audio.speech'
           WHEN 'embedding'  THEN 'text.embed'
       END,
       m.full_id, m.params, m.created_at, m.updated_at
FROM modality_models m
WHERE m.modality IN ('image_gen', 'image_edit', 'vision', 'video_gen', 'stt', 'tts', 'embedding')
ON CONFLICT (scope, capability) DO NOTHING;
