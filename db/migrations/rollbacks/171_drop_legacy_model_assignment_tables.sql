-- Rollback 171 — 구 모델 배정 3테이블 재생성(069·071·118 + 119 역할 CHECK 그대로) + model_assignments 역이관.
-- 170 의 매핑을 거꾸로: 슬롯 code → text.code/review, reasoning → text.reason/research, 나머지는 같은 이름.

CREATE TABLE IF NOT EXISTS user_model_roles (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role           TEXT NOT NULL CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary', 'planner')),
    full_model_id  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS global_model_roles (
    role           TEXT PRIMARY KEY CHECK (role IN ('chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary', 'planner')),
    full_model_id  TEXT NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
CREATE INDEX IF NOT EXISTS idx_capability_models_scope ON capability_models (scope);

INSERT INTO capability_models (scope, capability, full_id, params, created_at, updated_at)
SELECT scope,
       CASE slot WHEN 'code' THEN 'text.code' WHEN 'reasoning' THEN 'text.reason' ELSE slot END,
       full_id, params, created_at, updated_at
  FROM model_assignments
 WHERE (CASE slot WHEN 'code' THEN 'text.code' WHEN 'reasoning' THEN 'text.reason' ELSE slot END) IN (
        'text.reason', 'text.code', 'text.synthesize', 'text.embed',
        'vision.describe', 'vision.ocr',
        'image.generate', 'image.edit',
        'audio.transcribe', 'audio.speech', 'audio.analyze',
        'music.analyze', 'music.generate',
        'video.generate', 'video.analyze',
        'web.search')
ON CONFLICT (scope, capability) DO NOTHING;

INSERT INTO user_model_roles (user_id, role, full_model_id, created_at, updated_at)
SELECT m.scope,
       CASE m.slot WHEN 'code' THEN 'review' WHEN 'reasoning' THEN 'research' ELSE m.slot END,
       m.full_id, m.created_at, m.updated_at
  FROM model_assignments m
  JOIN users u ON u.id = m.scope
 WHERE (CASE m.slot WHEN 'code' THEN 'review' WHEN 'reasoning' THEN 'research' ELSE m.slot END) IN (
        'chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary', 'planner')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO global_model_roles (role, full_model_id, updated_at)
SELECT CASE slot WHEN 'code' THEN 'review' WHEN 'reasoning' THEN 'research' ELSE slot END,
       full_id, updated_at
  FROM model_assignments
 WHERE scope = '__global__'
   AND (CASE slot WHEN 'code' THEN 'review' WHEN 'reasoning' THEN 'research' ELSE slot END) IN (
        'chat', 'agent', 'judge', 'research', 'spawn', 'review', 'router', 'summary', 'planner')
ON CONFLICT (role) DO NOTHING;
