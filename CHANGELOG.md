# Changelog

## [1.19.0](https://github.com/openmake/openmake_llm/compare/v1.18.0...v1.19.0) (2026-08-01)


### ✨ 기능

* **chat:** 오케스트레이션 배정 정형화 — 벤치마크 기반 패턴·문구 튜닝 ([#422](https://github.com/openmake/openmake_llm/issues/422)) ([0627427](https://github.com/openmake/openmake_llm/commit/0627427774ab6767cf05b736c55ead38afb9b793))
* **chat:** 오케스트레이션 셰도우에 질의 프리뷰 추가 (087) ([#420](https://github.com/openmake/openmake_llm/issues/420)) ([7823461](https://github.com/openmake/openmake_llm/commit/7823461e117301efd8b2e400e5fccb3fddc2d146))


### 🐛 버그 수정

* **test:** CircuitBreaker 플레이키 수정 (CI 간헐 실패) ([#423](https://github.com/openmake/openmake_llm/issues/423)) ([0312a4f](https://github.com/openmake/openmake_llm/commit/0312a4fda4c34ec4927cba42a8bf3d9a360f25a9))

## [1.18.0](https://github.com/openmake/openmake_llm/compare/v1.17.0...v1.18.0) (2026-08-01)


### ✨ 기능

* **chat:** 오케스트레이션 자동 배정 Stage 1 — 모델이 토론·작업위임을 도구로 직접 배정 ([#417](https://github.com/openmake/openmake_llm/issues/417)) ([bb1ae7f](https://github.com/openmake/openmake_llm/commit/bb1ae7f3efcc5cf5807a46cd80fa559906169dd1))
* **chat:** 오케스트레이션 자동 배정 Stage 2 — 셰도우 계측 (086) ([#418](https://github.com/openmake/openmake_llm/issues/418)) ([f0bd2c7](https://github.com/openmake/openmake_llm/commit/f0bd2c7c3d601f1154249242dcfea63ec09ceb08))
* **providers:** 외부 provider LiteLLM 통합 게이트웨이 라우팅 (LLM_GATEWAY_PROVIDERS) ([#413](https://github.com/openmake/openmake_llm/issues/413)) ([104cb85](https://github.com/openmake/openmake_llm/commit/104cb85e9e87b2e939d671743b5705f65207299e))
* **router:** 어휘 2차 보강 + ESG 기대치 교정 (라우팅 83.3% → 93.3%) ([#412](https://github.com/openmake/openmake_llm/issues/412)) ([0b922f1](https://github.com/openmake/openmake_llm/commit/0b922f190848b6349f2bb9ae8150a0aca3fef25e))


### 🐛 버그 수정

* 라우팅 정확도 50%→83.3% + 테스트 DB 격리 + 신규 DB 부트스트랩 복구 ([#411](https://github.com/openmake/openmake_llm/issues/411)) ([1cfee0e](https://github.com/openmake/openmake_llm/commit/1cfee0e676d99bd526c79db601c8c9ac0a996109))
* 중단된 Deep Research 세션 정리 + 골든셋 카테고리 어휘 정렬 ([#409](https://github.com/openmake/openmake_llm/issues/409)) ([89f32f0](https://github.com/openmake/openmake_llm/commit/89f32f07ebdf2fb6bd66a0cb96347aaff276ba25))

## [1.17.0](https://github.com/openmake/openmake_llm/compare/v1.16.1...v1.17.0) (2026-07-30)


### ✨ 기능

* **report:** P1 보고서 파이프라인 Phase 1-3 — reportdata 계약·결정적 렌더·Task 위임·pdf/docx export ([#404](https://github.com/openmake/openmake_llm/issues/404)) ([fd33449](https://github.com/openmake/openmake_llm/commit/fd3344948324d979ae2ca6a8b9c932472eba4f42))


### ♻️ 리팩터링

* 계약 공유 층 완성 + routes 계층 경계 정리 (구조 감사 후속) ([#408](https://github.com/openmake/openmake_llm/issues/408)) ([c1f8a7f](https://github.com/openmake/openmake_llm/commit/c1f8a7f9c03391e4c61bb94a2043deede543b789))

## [1.16.1](https://github.com/openmake/openmake_llm/compare/v1.16.0...v1.16.1) (2026-07-29)


### 🐛 버그 수정

* **desktop:** afterPack 에 asar 로컬 require 검증 추가 (build.files 누락 재발 방지) ([#402](https://github.com/openmake/openmake_llm/issues/402)) ([3a8b27e](https://github.com/openmake/openmake_llm/commit/3a8b27ec2a99bca1b29814079e7af524e1b88ae4))
* **desktop:** v1.7.1 — asar 에 agent-browser.js 누락 수정 (창 미표시 결함) ([#401](https://github.com/openmake/openmake_llm/issues/401)) ([a4d812d](https://github.com/openmake/openmake_llm/commit/a4d812d0f736a385f95b9419064529c48e0d863f))

## [1.16.0](https://github.com/openmake/openmake_llm/compare/v1.15.1...v1.16.0) (2026-07-28)


### ✨ 기능

* **artifacts:** 실행 불가 코드에 실행 버튼을 노출하지 않도록 판정 추가 ([#396](https://github.com/openmake/openmake_llm/issues/396)) ([c9787da](https://github.com/openmake/openmake_llm/commit/c9787da381b208195bd6ebb7ad8a81badebd7c23))
* **desktop:** 에이전트 browser 도구를 로컬 Electron Chromium 에서 실행 (Cowork D3) ([#398](https://github.com/openmake/openmake_llm/issues/398)) ([be7f3ae](https://github.com/openmake/openmake_llm/commit/be7f3ae5ca20e0975457d8cf9893a87b5a06effb))

## [1.15.1](https://github.com/openmake/openmake_llm/compare/v1.15.0...v1.15.1) (2026-07-28)


### 🐛 버그 수정

* **mcp:** env 복호화를 fail-closed 로 전환하고 전역 로드 경로 복호화 누락 수정 ([#393](https://github.com/openmake/openmake_llm/issues/393)) ([9f4e27d](https://github.com/openmake/openmake_llm/commit/9f4e27d654594bf4fc5fbada488add23e0de8bc7))
* **security:** 외부 provider 키·OAuth 토큰 복호화를 fail-closed 로 전환 ([#395](https://github.com/openmake/openmake_llm/issues/395)) ([c9cf9e0](https://github.com/openmake/openmake_llm/commit/c9cf9e0dc7892a09e48bd43b5f27ecb40b5d16bf))

## [1.15.0](https://github.com/openmake/openmake_llm/compare/v1.14.0...v1.15.0) (2026-07-28)


### ✨ 기능

* **agent-task:** 예약 리포트 산출물 자동 게시 + 뉴스 유실·날짜 오기 수정 ([#387](https://github.com/openmake/openmake_llm/issues/387)) ([a32bea8](https://github.com/openmake/openmake_llm/commit/a32bea83eb909d8fa04767674d390237b83a07c6))
* **mcp:** 등록된 서버의 자격증명(env) 교체 기능 추가 ([#390](https://github.com/openmake/openmake_llm/issues/390)) ([6693bc3](https://github.com/openmake/openmake_llm/commit/6693bc30a5cb1e28d61e322a48de0cb038b1337a))


### 🐛 버그 수정

* **mcp:** 샌드박스 env 값이 ps 인자로 평문 노출되던 문제 차단 ([#389](https://github.com/openmake/openmake_llm/issues/389)) ([218fb07](https://github.com/openmake/openmake_llm/commit/218fb071973b7b412122224b6472441e0884ea46))
* **mcp:** 수동 [연결] 경로에서 암호화된 env 를 복호화하지 않던 문제 ([#391](https://github.com/openmake/openmake_llm/issues/391)) ([01d9504](https://github.com/openmake/openmake_llm/commit/01d95042caa422efcc3a3667fc12df9740e593e9))
* **mcp:** 수동 [연결]이 user 소유 서버를 전역 등록해 타 사용자에게 노출되던 문제 ([#392](https://github.com/openmake/openmake_llm/issues/392)) ([b1cf31b](https://github.com/openmake/openmake_llm/commit/b1cf31ba066a010786f39dba2c801a3411acac06))

## [1.14.0](https://github.com/openmake/openmake_llm/compare/v1.13.0...v1.14.0) (2026-07-27)


### ✨ 기능

* **agent-task:** 하위 폴더 인지 개선 + 데스크톱 연결 폴더 가시화 ([#382](https://github.com/openmake/openmake_llm/issues/382)) ([baaea50](https://github.com/openmake/openmake_llm/commit/baaea5099428682fad789fe1f56a8cc50d7bad83))


### 🐛 버그 수정

* **agent-task:** 잘못 놓인 요청 옵션을 조용히 버리지 않고 거절 ([#384](https://github.com/openmake/openmake_llm/issues/384)) ([44f7e5a](https://github.com/openmake/openmake_llm/commit/44f7e5a824705303c6155bd65dad614118f47101))
* **chat:** 응답·대화기록의 model 을 실제로 답한 모델로 기록 ([#385](https://github.com/openmake/openmake_llm/issues/385)) ([855d7a8](https://github.com/openmake/openmake_llm/commit/855d7a8e460870931aaf1468f306daa03a3f6bd3))
* **desktop:** 자동 업데이트 교체 로직 3가지 결함 수정 (v1.5.0) ([#380](https://github.com/openmake/openmake_llm/issues/380)) ([f99029f](https://github.com/openmake/openmake_llm/commit/f99029fcd6303416e8968e7bbe9ed275de81b102))

## [1.13.0](https://github.com/openmake/openmake_llm/compare/v1.12.0...v1.13.0) (2026-07-26)


### ✨ 기능

* **llm:** 외부 BYOK provider 를 로컬 토큰 쿼터에서 명시 면제 ([#379](https://github.com/openmake/openmake_llm/issues/379)) ([8ff8751](https://github.com/openmake/openmake_llm/commit/8ff8751a46df4c419cd488277da717aaf118a507))


### 🐛 버그 수정

* **providers:** OAuth role 경로의 사용량 기록 누락 ([#377](https://github.com/openmake/openmake_llm/issues/377)) ([1b29f22](https://github.com/openmake/openmake_llm/commit/1b29f22bcf9a7bec8b9048b0dde817553dceb32c))

## [1.12.0](https://github.com/openmake/openmake_llm/compare/v1.11.0...v1.12.0) (2026-07-26)


### ✨ 기능

* **deep-research:** 스킬 지식 + MCP 도구 근거를 리서치 파이프라인에 연결 ([#375](https://github.com/openmake/openmake_llm/issues/375)) ([fc8503d](https://github.com/openmake/openmake_llm/commit/fc8503d23cdbe843b415ae6a7ad667bcf07b3e23))

## [1.11.0](https://github.com/openmake/openmake_llm/compare/v1.10.0...v1.11.0) (2026-07-26)


### ✨ 기능

* **models:** 실사용 불가 외부 모델을 목록에서 제외 ([#374](https://github.com/openmake/openmake_llm/issues/374)) ([6ac8272](https://github.com/openmake/openmake_llm/commit/6ac82727432cc100be75112ed37a5385c6fd5c62))


### 🐛 버그 수정

* **chat:** 외부 모델 비전 오차단 교정 + 실패 시 로컬 폴백 ([#372](https://github.com/openmake/openmake_llm/issues/372)) ([d99fe3d](https://github.com/openmake/openmake_llm/commit/d99fe3dc67ba6c78bd759f0c2849dfc8ff8de118))

## [1.10.0](https://github.com/openmake/openmake_llm/compare/v1.9.0...v1.10.0) (2026-07-26)


### ✨ 기능

* **agent-task:** 스킬 자동 선택(load_skill) 을 에이전트 작업에도 적용 ([#371](https://github.com/openmake/openmake_llm/issues/371)) ([3073e4b](https://github.com/openmake/openmake_llm/commit/3073e4b405f7ec0141b1be3de0ca25bbf8f25dd6))


### 🐛 버그 수정

* **providers:** 역할 배정된 ChatGPT 모델이 403 으로 로컬 폴백되던 문제 ([#369](https://github.com/openmake/openmake_llm/issues/369)) ([57d615d](https://github.com/openmake/openmake_llm/commit/57d615d2568641f3174f004578b7d3e3e010dbdc))

## [1.9.0](https://github.com/openmake/openmake_llm/compare/v1.8.0...v1.9.0) (2026-07-26)


### ✨ 기능

* **providers:** ChatGPT 구독 OAuth provider 추가 + /v1 외부 모델 개방 ([#367](https://github.com/openmake/openmake_llm/issues/367)) ([e14b3dd](https://github.com/openmake/openmake_llm/commit/e14b3ddbfe24269d5adcbf37da052fd1808bd3bd))

## [1.8.0](https://github.com/openmake/openmake_llm/compare/v1.7.1...v1.8.0) (2026-07-26)


### ✨ 기능

* **desktop:** exec OS 샌드박스(sandbox-exec) — 3단 방어 완성 (v1.4.0) ([#364](https://github.com/openmake/openmake_llm/issues/364)) ([7a0ae74](https://github.com/openmake/openmake_llm/commit/7a0ae74e1286d4bf94c493a849d5bed482544d26))


### 🐛 버그 수정

* **infra:** mcp-runtime 이미지에 chromium 시스템 의존성 베이킹 ([#344](https://github.com/openmake/openmake_llm/issues/344)) ([d6887d4](https://github.com/openmake/openmake_llm/commit/d6887d4c6ba685f221555bd5e081431f1ba23484))

## [1.7.1](https://github.com/openmake/openmake_llm/compare/v1.7.0...v1.7.1) (2026-07-26)


### 🐛 버그 수정

* **desktop:** 데스크톱앱 보안 하드닝 + 로컬 브리지 exec 신뢰 모델 ([#362](https://github.com/openmake/openmake_llm/issues/362)) ([b9c9f85](https://github.com/openmake/openmake_llm/commit/b9c9f850dcfaf09acaa9b55930bb7c0acacb60ec))
* **security:** 소스 보안 감사 수정 13건 — IDOR·RCE·SSRF·인증·CSRF·하드닝 ([#361](https://github.com/openmake/openmake_llm/issues/361)) ([f49b53c](https://github.com/openmake/openmake_llm/commit/f49b53cbefdb78e792c170e2736c1a5299017e89))
* 공개 저장소의 개인 식별자·고정 자격증명 제거 ([#359](https://github.com/openmake/openmake_llm/issues/359)) ([2fccee0](https://github.com/openmake/openmake_llm/commit/2fccee018fb7363fd48981ba51fc3e11daf50a37))

## [1.7.0](https://github.com/openmake/openmake_llm/compare/v1.6.0...v1.7.0) (2026-07-25)


### ✨ 기능

* **desktop:** 서버 매니페스트 기반 자체 업데이터 (v1.2.1) ([#357](https://github.com/openmake/openmake_llm/issues/357)) ([91767fb](https://github.com/openmake/openmake_llm/commit/91767fbdb37e3050137a7d9cc5445a0c26886e3a))

## [1.6.0](https://github.com/openmake/openmake_llm/compare/v1.5.7...v1.6.0) (2026-07-25)


### ✨ 기능

* **agent-task:** 로컬 브리지 실행기 — 사용자 머신에서 도구 실행 (Cowork D1a) ([#353](https://github.com/openmake/openmake_llm/issues/353)) ([7fad490](https://github.com/openmake/openmake_llm/commit/7fad490fac5c6c79cd78c7b650657168d4af7c30))
* **desktop:** 로컬 브리지 실행기 — 폴더 연결 후 에이전트 작업을 사용자 머신에서 실행 (Cowork D1b) ([#354](https://github.com/openmake/openmake_llm/issues/354)) ([ee6aa3b](https://github.com/openmake/openmake_llm/commit/ee6aa3b014258f7ee99437a3c5e75aa5869b562a))
* **web:** 컴포저 로컬 실행 토글 + 작업 목록 뱃지 (Cowork D2) ([#355](https://github.com/openmake/openmake_llm/issues/355)) ([b06ea36](https://github.com/openmake/openmake_llm/commit/b06ea361607f44325d63d7fe1d8334ae61c28128))


### ♻️ 리팩터링

* **task-sandbox:** 도구 실행 백엔드를 TaskExecutor 인터페이스로 추상화 (Cowork 트랙 D0) ([#351](https://github.com/openmake/openmake_llm/issues/351)) ([3042db7](https://github.com/openmake/openmake_llm/commit/3042db7cba41fd1717da6ddcc8ccb9328371b808))

## [1.5.7](https://github.com/openmake/openmake_llm/compare/v1.5.6...v1.5.7) (2026-07-25)


### 🐛 버그 수정

* **build-info:** version·gitTag 가 /health 응답에 실리지 않던 누락 수정 ([#348](https://github.com/openmake/openmake_llm/issues/348)) ([71a093c](https://github.com/openmake/openmake_llm/commit/71a093c4507274cba813ab15c2200527234b2c24))
* **deps:** workspace 내부 참조를 버전 무관(*)으로 — Release PR npm ci 404 수정 ([#350](https://github.com/openmake/openmake_llm/issues/350)) ([24ff897](https://github.com/openmake/openmake_llm/commit/24ff897f95521473ad2cc6f7a3dc5edf04eb31be))
