# Changelog

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
