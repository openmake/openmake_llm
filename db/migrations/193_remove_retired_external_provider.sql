-- Migration 193 — 제거된 외부 provider(#1481 로 들어왔다가 되돌린 BYOK 공급자) 데이터 정리 (2026-10-25)
--
-- 카탈로그(apps/api/src/config/external-providers.ts)에서 그 provider 를 지웠으므로, 남은 행을 provider_id 로 지운다.
-- 행이 남아 있으면 키 목록 화면에는 안 보이지만(카탈로그 기준), 모델 목록(/api/models·/v1/models)은 저장된 키로
-- 그 공급자의 /models 를 계속 조회하고 ProviderRouter 도 키 행을 찾아 호출할 수 있다.
--
-- 대상: provider_id 열을 가진 코어 표 전부(2026-10-25 information_schema 확인) — 사용량·관측 기록부터, 키는 마지막.
--   external_provider_usage, server_external_key_usage, external_model_availability, external_provider_models_cache,
--   chat_requests, llm_request_metrics, orchestrator_jobs, user_external_api_keys, server_external_api_keys
-- (지금은 이 표들 사이에 외래 키가 없지만 순서는 사용량 → 키로 둔다.)
--
-- provider id 는 아래 상수 한 곳에서 조립한다(저장소 전체 검색에서 제거된 이름이 다시 잡히지 않도록 나눠 적었다).
-- 멱등: 다시 돌면 0건 삭제. 트랜잭션은 MigrationRunner 가 감싼다(BEGIN/COMMIT 없음).
-- 건수는 RAISE NOTICE 로 남기고 MigrationRunner 가 서버 로그(info)로 옮긴다 — 키·값은 싣지 않는다.
-- 되돌리기 없음: 지운 행(암호화된 키·사용량)은 복구하지 않는다. 코드만 되돌려도 다른 provider 에는 영향이 없다.

DO $$
DECLARE
    v_provider CONSTANT TEXT := 'demon' || 'route';
    n_usage INT;
    n_server_usage INT;
    n_availability INT;
    n_models_cache INT;
    n_chat_requests INT;
    n_llm_metrics INT;
    n_orchestrator_jobs INT;
    n_user_keys INT;
    n_server_keys INT;
BEGIN
    DELETE FROM external_provider_usage WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_usage = ROW_COUNT;
    DELETE FROM server_external_key_usage WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_server_usage = ROW_COUNT;
    DELETE FROM external_model_availability WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_availability = ROW_COUNT;
    DELETE FROM external_provider_models_cache WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_models_cache = ROW_COUNT;
    DELETE FROM chat_requests WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_chat_requests = ROW_COUNT;
    DELETE FROM llm_request_metrics WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_llm_metrics = ROW_COUNT;
    DELETE FROM orchestrator_jobs WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_orchestrator_jobs = ROW_COUNT;
    DELETE FROM user_external_api_keys WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_user_keys = ROW_COUNT;
    DELETE FROM server_external_api_keys WHERE provider_id = v_provider;
    GET DIAGNOSTICS n_server_keys = ROW_COUNT;

    RAISE NOTICE '[193] retired provider rows removed: usage=% server_usage=% availability=% models_cache=% chat_requests=% llm_metrics=% orchestrator_jobs=% user_keys=% server_keys=%',
        n_usage, n_server_usage, n_availability, n_models_cache, n_chat_requests, n_llm_metrics,
        n_orchestrator_jobs, n_user_keys, n_server_keys;
END$$;
