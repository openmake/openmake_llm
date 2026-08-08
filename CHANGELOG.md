# Changelog

## [1.22.2](https://github.com/openmake/openmake_llm/compare/v1.22.1...v1.22.2) (2026-08-08)


### 🐛 버그 수정

* **agent-task:** 600줄 가드 준수 — maxTurns 결정 로직을 task-inputs 로 이동 ([5fb5d3a](https://github.com/openmake/openmake_llm/commit/5fb5d3a3554f43b78db8e8622f0c9b474b3af09d))
* **agent-task:** 대형 PDF 워크플로우 3중 결함 — 한글 파일명·턴 예산·승인 대기 가시성 ([8d4be98](https://github.com/openmake/openmake_llm/commit/8d4be98e7ddc4f5bcf4a523bc76298a3e9e1d783))
* **agent-task:** 대형 PDF 워크플로우 3중 결함 — 한글 파일명·턴 예산·승인 대기 가시성 ([aea8bd4](https://github.com/openmake/openmake_llm/commit/aea8bd4e1f1ca4d2a312da0347a396cdc1f0d334))
* **agent-task:** 추출 실패 문서도 턴 예산 상향 대상에 포함 ([ac0afff](https://github.com/openmake/openmake_llm/commit/ac0afff778746bddc4ddbb15748c91c605acfb08))
* **agent-task:** 추출 실패 문서도 턴 예산 상향 대상에 포함 ([9d12e7d](https://github.com/openmake/openmake_llm/commit/9d12e7d5066fa0c513f6cf27dcc123ec883038cb))

## [1.22.1](https://github.com/openmake/openmake_llm/compare/v1.22.0...v1.22.1) (2026-08-07)


### 🐛 버그 수정

* **live-check:** G3 task 도구 계측 사각 + 작업 아티팩트 버전조회 404 소음 제거 ([31ae430](https://github.com/openmake/openmake_llm/commit/31ae43023ec25ff253a9cf237b49b3c5cd16d3d4))
* **live-check:** G3 task 도구 계측 사각 + 작업 아티팩트 버전조회 404 소음 제거 ([4702f0e](https://github.com/openmake/openmake_llm/commit/4702f0efa7facbaa0b4dd1bc33294a1f72097dc7))

## [1.22.0](https://github.com/openmake/openmake_llm/compare/v1.21.0...v1.22.0) (2026-08-07)


### ✨ 기능

* **admin:** 관리자 전용 전체 대화 조회 화면 분리 ([a01ff44](https://github.com/openmake/openmake_llm/commit/a01ff44ec21108ce3676123544df94a093138262))
* **admin:** 관리자 전용 전체 대화 조회 화면 분리 ([28e2ab5](https://github.com/openmake/openmake_llm/commit/28e2ab508d8e54979b9d8bfa805ad60a99ff991d))
* **agent-task:** 실행 스텝→플랜 노드 귀속 계측 (Execution Graph 증분 2) ([a72280f](https://github.com/openmake/openmake_llm/commit/a72280f240d4f1316f30096208ecb0dec99bfeba))
* **agent-task:** 실행 스텝을 플랜 노드에 귀속 — plan_step_index 계측 (Execution Graph 증분 2) ([ad42acc](https://github.com/openmake/openmake_llm/commit/ad42accd07d2d55ebbc95dc028440575706f0e38))
* **agent-task:** 플랜 자동 진행 — 마킹 공백 결정적 승격 (Execution Graph 증분 3) ([58a37c6](https://github.com/openmake/openmake_llm/commit/58a37c6165ef505795b44b023def6d97ce5c81e4))
* **agent-task:** 플랜 자동 진행 — 완료/차단 후 다음 단계 결정적 in_progress 승격 (증분 3) ([e6d2d96](https://github.com/openmake/openmake_llm/commit/e6d2d962de69da5bfced73c4b17dfdd710763aab))
* **cli:** CLI 채팅 히스토리 저장 + MCP 샌드박스 대화 데드코드 정리 ([accd7ca](https://github.com/openmake/openmake_llm/commit/accd7ca8a6287dafe7bbc2afe8546d7f5d861aca))
* **cli:** CLI 채팅 히스토리 저장 + MCP 샌드박스 대화 데드코드 정리 ([c400ada](https://github.com/openmake/openmake_llm/commit/c400adaebd673a81ec49b96ac5e6df6d5075ae8c))
* **history:** 히스토리 커버리지 확장 — structured 저장·관리자 작업/리서치 탭·OpenAI 호환 세션 연속성 ([9d4f297](https://github.com/openmake/openmake_llm/commit/9d4f297beff796469d4362b4e49ec7cb77f15b59))
* **history:** 히스토리 커버리지 확장 — structured 저장·관리자 작업/리서치 탭·OpenAI 호환 세션 연속성 ([08ff479](https://github.com/openmake/openmake_llm/commit/08ff479f0833fdaffedb33059fc610070b5cf2ec))
* **install:** Linux/macOS 원샷 설치 스크립트 (installer 브랜치 부활 rebase) ([51c134e](https://github.com/openmake/openmake_llm/commit/51c134e0beb0e0f873d1e446d30e8f7933407122))
* **install:** Linux/macOS 원샷 설치 스크립트 + 신규 클론 부팅 차단 버그 수정 ([644f880](https://github.com/openmake/openmake_llm/commit/644f88010ec36faf50ab7f42e185f81f37c4e085))
* **metrics:** 도구 결과 절단 셰도우 계측 (G3, measure-first) ([0c01c56](https://github.com/openmake/openmake_llm/commit/0c01c5615b3285bee1a4a29be5c3542df02c4722))
* **metrics:** 도구 결과 절단 셰도우 계측 (G3, measure-first) ([c82408e](https://github.com/openmake/openmake_llm/commit/c82408e05583312bda003d1b904a2244cab8ac75))
* **pdf:** opendataloader 2.5.0 업그레이드 + task 샌드박스 다국어 분석·산출 베이킹 ([c7b9f34](https://github.com/openmake/openmake_llm/commit/c7b9f3430d4e546ff81ba021fa31c25bb7bf152d))
* **pdf:** opendataloader 2.5.0 업그레이드 + task 샌드박스 다국어 분석·산출 베이킹 ([d60bf40](https://github.com/openmake/openmake_llm/commit/d60bf40bab2139fdd528c16f18aaa565bfcc8ed3))
* **web-search:** web_search 도구 결과에 검색 소스 라벨 표시 ([e6aa914](https://github.com/openmake/openmake_llm/commit/e6aa914bb71c94d4f8b540f58626b164dba9f53c))
* **web-search:** web_search 도구 결과에 검색 소스 라벨 표시 ([eedc5c9](https://github.com/openmake/openmake_llm/commit/eedc5c95c902764a2a32b681868a8fbba3a14f5e))
* **web:** 게스트 채팅 첫 화면에 다국어 응답 안내 ([102e128](https://github.com/openmake/openmake_llm/commit/102e128171a69cc9bf9ecd7c102ae0e47961a839))
* **web:** 게스트 채팅 첫 화면에 다국어 응답 안내 추가 ([ab8e14d](https://github.com/openmake/openmake_llm/commit/ab8e14d312b01d3bb5a155d64e1790a8102737a2))
* **web:** 스크랩 캐시(G1)·URL 정규화(G4)·외부 콘텐츠 경계 가드(G2) ([a96db79](https://github.com/openmake/openmake_llm/commit/a96db794789530ddadb2e28c7cf07bbe89422ec5))
* **web:** 스크랩 캐시(G1)·URL 정규화(G4)·외부 콘텐츠 경계 가드(G2) ([696e209](https://github.com/openmake/openmake_llm/commit/696e209ee3de735b42f10473d7e69a38fce23295))
* **web:** 작업 상세 스텝에 플랜 노드 뱃지 (plan_step_index 가시화) ([b98efb6](https://github.com/openmake/openmake_llm/commit/b98efb656ecdf194e2b7dc177f6fb5ad40f60e69))
* **web:** 작업 상세 스텝에 플랜 노드 뱃지 표시 (plan_step_index 가시화) ([88bd2c8](https://github.com/openmake/openmake_llm/commit/88bd2c801c4bc39406213a6342c53c522c7c7442))
* **web:** 채팅 입력창 클립보드 붙여넣기 첨부 (⌘V/Ctrl+V) ([f62608d](https://github.com/openmake/openmake_llm/commit/f62608d72807535c32d4846ec12b06c4926a283b))


### 🐛 버그 수정

* **agent-task:** 샌드박스 도구 오류 5대 원인 해소 — 안내·관용화·오류 관측 ([5cf6f7d](https://github.com/openmake/openmake_llm/commit/5cf6f7d4eed9349b27c0408714cb15ec27120733))
* **agent-task:** 샌드박스 도구 오류 5대 원인 해소 — 안내·관용화·오류 관측 ([6a019d1](https://github.com/openmake/openmake_llm/commit/6a019d182617759e336230c5059350d30065094d))
* **install:** 실제 신규 설치 검증 — 마이그레이션 011 실패·포트/compose 이슈 수정 ([545fde0](https://github.com/openmake/openmake_llm/commit/545fde0bae7de5aae9ebc22afd6f3f96d1fe44e2))
* **mcp:** mcp-python-repl 에 mcp&lt;2 제약 — mcp 2.x fastmcp 제거로 기동 실패 회피 ([9b0e08a](https://github.com/openmake/openmake_llm/commit/9b0e08ac5921f5ffbed5ff5e4ee7cdc9ed4b396b))
* **mcp:** mcp-python-repl 에 mcp&lt;2 제약 — mcp 2.x fastmcp 제거로 기동 실패 회피 ([33d3e91](https://github.com/openmake/openmake_llm/commit/33d3e912dd794425b4c7092e817d2995d71d02f6))
* **web-search:** 소스 라벨 비도메인 식별자(searxng) 정규화 ([ffd5ec3](https://github.com/openmake/openmake_llm/commit/ffd5ec34bdd8d40158a24bce2f752bd2e0e42e4c))
* **web-search:** 소스 라벨 비도메인 식별자(searxng) 정규화 ([68a9cf4](https://github.com/openmake/openmake_llm/commit/68a9cf4a444f39db679d9a06d535845e8b01619a))


### ♻️ 리팩터링

* **data:** addAgentTaskStep 래퍼 파라미터 타입을 repository 참조로 (파일 크기 가드) ([eca38d1](https://github.com/openmake/openmake_llm/commit/eca38d1f88ac640befd2b4c40507e7eef1c7800e))

## [1.21.0](https://github.com/openmake/openmake_llm/compare/v1.20.0...v1.21.0) (2026-08-05)


### ✨ 기능

* **agent-task:** Execution Graph 증분 1 — 스텝 도구의도 영속 + 턴 재시도 + HITL 무응답 강등 ([bbc78ec](https://github.com/openmake/openmake_llm/commit/bbc78ecaf111e1fbdf508ffeea3070ac87a1c4d1))
* **agent-task:** HITL 무응답 강등 — 승인 timeout 연속 시 승인 필요 도구 제거 후 마무리 유도 ([34d10a8](https://github.com/openmake/openmake_llm/commit/34d10a814cc4804ce1e5a2bb322e702b3861ca14))
* **agent-task:** 턴 LLM 호출 일시적 오류 지수 백오프 재시도 (노드 retry 정책 1단계) ([8b45df6](https://github.com/openmake/openmake_llm/commit/8b45df60282c758e44d68891d4bba46196675190))
* **agent-task:** 턴 도구 호출 의도를 스텝 tool_name 으로 영속화 ([150127a](https://github.com/openmake/openmake_llm/commit/150127a4a3624948f4ec8e4290d7c28c13fc9f7b))
* **web:** 히스토리 최근대화에 에이전트 작업 항목 통합 ([d74fabc](https://github.com/openmake/openmake_llm/commit/d74fabcc3234e9dffd89c3f4e61ef2c66cf4216b))
* **web:** 히스토리 최근대화에 에이전트 작업 항목 통합 (B 방식 — read-only 조합) ([f3a08fb](https://github.com/openmake/openmake_llm/commit/f3a08fb15c066f545f3c944281ab9eb2cf2989d5))


### ♻️ 리팩터링

* **agent-task:** 턴 자원 가드를 turn-gate 모듈로 분리 (파일 크기 가드) ([e6bf66b](https://github.com/openmake/openmake_llm/commit/e6bf66b69fc7ad32f941cf78786fab4fa7cf13d8))

## [1.20.0](https://github.com/openmake/openmake_llm/compare/v1.19.0...v1.20.0) (2026-08-03)


### ✨ 기능

* **agent-task:** 청크 업로드 — Cloudflare 요청당 100MB 상한 우회 ([f77e48e](https://github.com/openmake/openmake_llm/commit/f77e48e749099f410045687b680a0e8c094e1f59))
* **agent-task:** 청크 업로드 — Cloudflare 요청당 100MB 상한 우회 ([ef3b154](https://github.com/openmake/openmake_llm/commit/ef3b1540ea30538fb2b29f01922f51567e2db95a))
* **chat:** 응답 신뢰성·관측 개선 — 툴콜 누수·언어 혼입·토론 근거·TTFT 분해 ([83ade02](https://github.com/openmake/openmake_llm/commit/83ade02c89074b7ed7eb5b936aa286fb66fcac60))
* **chat:** 응답 신뢰성·관측 개선 — 툴콜 누수·언어 혼입·토론 근거·TTFT 분해 ([3b78bf7](https://github.com/openmake/openmake_llm/commit/3b78bf737e5c04be18c741bf9d7e1a684383fa6a))
* **observability:** 에이전트 작업 비용 집계 + 마무리 턴 발동 관측 ([e3757e7](https://github.com/openmake/openmake_llm/commit/e3757e70cba338b2dfb30118e730c8bacc89b272))
* **ocr:** 스캔 PDF 처리 — 샌드박스 OCR 도구 + 네이티브 추출 폴백 ([25cab92](https://github.com/openmake/openmake_llm/commit/25cab925d5e9203f734a8ec275c474a6f1fb7732))
* **ocr:** 스캔 PDF 처리 2축 — 샌드박스 OCR 도구 + 네이티브 추출 폴백 ([8629454](https://github.com/openmake/openmake_llm/commit/8629454f401d4a8daaf2316cb40ce67cdb930b6d))
* **security:** SSRF IPv6 대역 보강 + agent-tasks 전용 리미터 + 뷰어 서명키 fail-closed ([169838c](https://github.com/openmake/openmake_llm/commit/169838c2a0f9f50b8b297bc7c642575bfa61c1e7))
* **web/api:** 외부 키 검증·사용량 UI + OAuth 경로 일반화 + 죽은 엔드포인트 제거 ([ab13e22](https://github.com/openmake/openmake_llm/commit/ab13e226a326900f6bd78e052d285be00647b994))
* **web:** GA4 이중 측정 ID 전송 — 데모 전용 + 홈페이지 교차 도메인 통합 ([bf15bc8](https://github.com/openmake/openmake_llm/commit/bf15bc8ed479b58e9a1cb7fa92915c959c6aa725))
* **web:** 라우트 에러 바운더리·404 폴백 추가 ([31301ae](https://github.com/openmake/openmake_llm/commit/31301aecbe6addb0355084612185c318e85d5390))
* **web:** 백엔드 기능 미반영 3건 — 작업 실패 사유·리서치 삭제·모드 안내 ([5c867b7](https://github.com/openmake/openmake_llm/commit/5c867b719a98eaf1338418c1b09892314e51f616))


### 🐛 버그 수정

* **agent-task:** goal 길이 상한 2,000 → 20,000자 (config 외부화) ([e6b9744](https://github.com/openmake/openmake_llm/commit/e6b9744ff1d67398b7f895c7d8d23ee597a55a49))
* **agent-task:** goal 에 코드 블록·제네릭 허용 (allowHtmlLikeContent) ([2d16463](https://github.com/openmake/openmake_llm/commit/2d1646390158f9272bcc95ec2c2f33e323c722d8))
* **agent-task:** 자원 상한 도달 시 마무리 턴 강제 — 산출물 절단 차단 ([3408727](https://github.com/openmake/openmake_llm/commit/3408727d62058dada637435468f8a7c1f4bf0300))
* **agent-task:** 턴 상한 소진을 completed 로 오표시하던 문제 — failed + 재개 가능 ([a835bbc](https://github.com/openmake/openmake_llm/commit/a835bbc864b09615ef6d1d91d77f116a25be0bd8))
* **agents:** manifest 스킬 주입 시 스킬 이름 유실 — onSkillsActivated 미호출 수정 ([7182230](https://github.com/openmake/openmake_llm/commit/718223020b66b0c0bea4e4bd22353b4a34be3d4f))
* **chat:** 비스트리밍 이미지 누락·부분 응답 유실·특수모드 후처리 비대칭 수정 ([d9f049c](https://github.com/openmake/openmake_llm/commit/d9f049c1c23485205dc6250ee777cf2b4b5c3d99))
* **config:** RL_CHUNK_UPLOAD 을 windowMs 불변식 레지스트리에 등록 ([b7393bc](https://github.com/openmake/openmake_llm/commit/b7393bc225d3822e12f89f3923ac3385c7f3a474))
* **sandbox:** 컨테이너 절대경로(/workspace/...)를 탈출로 오판하던 문제 ([7a5846f](https://github.com/openmake/openmake_llm/commit/7a5846fca311cb1f2bf5b573f2a876a1e97b258a))
* **test:** agent-resolver 테스트를 env 임계값에서 분리 ([7bd1d36](https://github.com/openmake/openmake_llm/commit/7bd1d3609c053547cd5a5324c31fca63da7c5c10))
* **web:** WS 계약 갭 해소 — 토큰 갱신·배포 감지·리소스 카드·에러 처리 ([09b6f31](https://github.com/openmake/openmake_llm/commit/09b6f31e51e543a8c8c5e9219aed2f612a0fdbac))
* **web:** 백엔드↔프론트 정합 점검 후속 — WS 계약 갭·미반영 기능·백엔드 정리 ([a61423c](https://github.com/openmake/openmake_llm/commit/a61423c8f19a82c15dd733b98141acd919305183))


### ♻️ 리팩터링

* **agent-task:** AgentTaskService 600줄 가드 분할 (641→599) + 마무리 턴 도구 차단 ([61bf8aa](https://github.com/openmake/openmake_llm/commit/61bf8aa81c29a7bcfd9e6c96bb06759fbccea274))
* **chat:** external-provider 600줄 가드 분할 (683→554) ([6d98078](https://github.com/openmake/openmake_llm/commit/6d9807816efaa0f0c375dbc6851294f2694c1f5c))
* **chat:** 응답 후처리를 프로세서 파이프라인으로 정리 ([2268014](https://github.com/openmake/openmake_llm/commit/22680144e31c0ac8b44444542048a0bc19dcc6a4))

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
