CREATE TABLE IF NOT EXISTS mobile_push_tokens (
    device_token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
    bundle_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user
    ON mobile_push_tokens (user_id, updated_at DESC);
