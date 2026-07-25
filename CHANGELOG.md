# Changelog

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
