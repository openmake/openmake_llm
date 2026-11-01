-- 006 — 공간(Space)마다 임베딩 색인 하나를 고정한다(설계 2026-11-01 byok-embedding §4).
-- knowledge_embedding_indexes 는 "모델 색인 카탈로그"(모델·차원·거리척도 별 1행, 여러 행이 동시에 ready)가 되고,
-- knowledge_spaces.embedding_index_id 가 그 공간의 벡터가 사는 색인을 가리킨다.
-- 멱등·보존적: 데이터를 지우지 않는다. is_active·uq_knowledge_embedding_index_active 는 그대로 두고 더 쓰지 않는다
-- (2단계 삭제 — 다음 배포의 별도 마이그레이션). 롤백은 코드 되돌리기만으로 된다(새 열은 NULL 허용, 옛 코드는 읽지 않는다).

-- ① 색인 행의 요청 params(차원 지정 등) — 색인 임베더가 그대로 보낸다
ALTER TABLE knowledge_embedding_indexes ADD COLUMN IF NOT EXISTS request_params JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ② 공간 → 색인 고정(아래 ③ 이 이 열을 본다 — 먼저 만든다)
ALTER TABLE knowledge_spaces ADD COLUMN IF NOT EXISTS embedding_index_id TEXT REFERENCES knowledge_embedding_indexes(id);
CREATE INDEX IF NOT EXISTS idx_knowledge_spaces_embedding_index ON knowledge_spaces(embedding_index_id) WHERE embedding_index_id IS NOT NULL;

-- ③ 같은 모델·차원·척도의 ready 색인은 하나 — 생성 경합은 이 유니크가 막는다.
--    활성이 아닌데 ready 로 남은 행(옛 reindex 잔재)은 retired 로만 바꾼다(벡터는 그대로).
--    공간이 가리키는 색인은 제외한다 — 006 이후 코드의 색인은 모두 ready·비활성이라, 다시 적용될 때 살아 있는 색인을 지키게.
--    진행 중(queued·running) 공간 재색인 작업의 대상 색인도 제외한다 — 아직 어느 공간도 가리키지 않지만 곧 전환된다.
--    (space_id 가 없는 옛 전역 reindex 작업은 보지 않는다 — 첫 적용은 종전과 같다)
UPDATE knowledge_embedding_indexes SET status = 'retired', retired_at = COALESCE(retired_at, NOW())
 WHERE status = 'ready' AND is_active = FALSE
   AND NOT EXISTS (SELECT 1 FROM knowledge_spaces s WHERE s.embedding_index_id = knowledge_embedding_indexes.id)
   AND NOT EXISTS (SELECT 1 FROM knowledge_ingestion_jobs j
                    WHERE j.embedding_index_id = knowledge_embedding_indexes.id AND j.space_id IS NOT NULL
                      AND j.state IN ('queued', 'running'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_embedding_index_ready_model
    ON knowledge_embedding_indexes(provider_ref, dimension, distance_metric) WHERE status = 'ready';

-- ④ 백필 — 지금 활성 색인으로. 활성이 없으면 NULL 로 두고 첫 수집이 고정한다.
UPDATE knowledge_spaces s SET embedding_index_id = a.id
  FROM (SELECT id FROM knowledge_embedding_indexes WHERE is_active = TRUE LIMIT 1) a
 WHERE s.embedding_index_id IS NULL;
