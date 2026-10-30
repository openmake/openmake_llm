# 외부 provider 카탈로그 운영 절차

`apps/api/src/config/external-providers.ts` 의 `EXTERNAL_PROVIDER_CATALOG` 에 사용자 BYO 키 공급자를
추가·제거할 때의 체크리스트다. 카탈로그는 모든 사용자에게 보이는 목록이므로 "일단 넣고 나중에 검증"은 하지 않는다.

## 추가

1. **실측이 먼저다.** `npm run eval:probe -- --model <model-id>` 로 응답·도구 호출·비전·추론 필드를 확인한다.
   프로브가 확정하지 못한 capability 는 `false` 로 둔다.
2. **실측 전에는 `enabled: false`.** 공개 노출은 소유자 승인 뒤에만 켠다. 미검증 공급자를 기본 노출하면
   사용자가 키를 등록하고 실패를 겪는다.
3. **`fallbackModels` 는 실측한 모델만.** 가격·무료 여부는 공급자 사이트 기준임을 `helpText` 에 적고,
   확인하지 못한 값은 단정하지 않는다.
4. **`helpText` 에 위험을 적는다.** 무검열·성인 파인튜닝처럼 조직 정책에 영향을 주는 성격이 있으면 명시한다.
5. **LiteLLM 게이트웨이는 실측 뒤에.** `scripts/vllm/litellm.config.yaml` 의 wildcard 를 넣어도
   `LLM_GATEWAY_PROVIDERS` 에는 실측 전 추가하지 않는다.
6. **`provider-gate` 접두사를 함께 고친다.** `KNOWN_FULLID_PREFIXES` 에 id 를 넣지 않으면
   `provider:model` 이 로컬 모델로 오분류된다. 카탈로그 항목과 접두사를 같은 PR 에서 바꾸고 회귀 테스트를 남긴다.
7. **자산·예시.** 로고는 직접 그린 자산만 쓰고(외부 상표 금지), `.env.example` 예시는 실제로 쓰는 경우에만 갱신한다.

## 제거

1. **한 PR 에서 코드·설정·웹 자산·테스트를 함께 지운다.** 카탈로그 항목, `KNOWN_FULLID_PREFIXES`,
   모델 선택기 라벨, 로고, LiteLLM wildcard, `.env.example` 예시.
2. **DB 행을 마이그레이션으로 정리한다.** `provider_id` 열을 가진 표를 `information_schema` 로 확인하고
   (`SELECT table_name FROM information_schema.columns WHERE column_name='provider_id'`), 사용량 → 키 순으로 지운다.
   키 행이 남으면 모델 목록 조회와 라우터가 그 공급자를 계속 호출할 수 있다.
3. **삭제 건수는 로그로 남기고 키·값은 싣지 않는다.** `RAISE NOTICE` 를 `MigrationRunner` 가 info 로그로 옮긴다.
4. **멱등하게 만든다.** 재실행 시 0건이어야 한다.
5. **릴리스 노출을 확인한다.** 그 코드가 릴리스 태그에 들어갔는지 보고, 들어갔으면 운영 DB 에 마이그레이션이
   적용됐는지 확인한다.

## 참고

- 카탈로그 항목 구조: `apps/api/src/config/external-providers.ts`
- provider 분류: `apps/api/src/services/chat-service/provider-gate.ts`
- 모델 실측: `apps/api/src/evaluation/model-probe.ts`, `npm run eval:probe`
- CI 회귀 매핑: `scripts/ci/feature-checks.manifest.json` (`deletedTests` 는 테스트 파일 삭제 사유를 기록한다.
  이름을 바꾸거나 옮긴 경우 git 은 삭제+추가로 보므로 옛 경로도 함께 적는다)
