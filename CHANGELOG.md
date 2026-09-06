# Changelog

## [1.47.0](https://github.com/openmake/openmake_llm/compare/v1.46.0...v1.47.0) (2026-09-06)


### ✨ 기능

* **local-bridge:** 코드 탐색 전용 kind(code_nav) — grep_code·repo_map 이 승인 창 없이 돈다 ([#774](https://github.com/openmake/openmake_llm/issues/774)) ([b1dcbe8](https://github.com/openmake/openmake_llm/commit/b1dcbe86a976dfc8786b64c674e77dc5784dd72e))


### 🐛 버그 수정

* **local-bridge:** code_nav 제외 목록을 이름 기준으로 — worktree 의 .git 은 파일이라 새어 들어왔다 ([#776](https://github.com/openmake/openmake_llm/issues/776)) ([5c3270e](https://github.com/openmake/openmake_llm/commit/5c3270e292e6da77d55426181bb27a59bc1638e1))

## [1.46.0](https://github.com/openmake/openmake_llm/compare/v1.45.3...v1.46.0) (2026-09-06)


### ✨ 기능

* **agent-task:** 코딩 고도화 1차 — 도구 결과 접기·grep_code/repo_map·workspace 테스트 게이트 ([#772](https://github.com/openmake/openmake_llm/issues/772)) ([c5969f9](https://github.com/openmake/openmake_llm/commit/c5969f9f8080741e01ff222ff6a68ad3e806831f))

## [1.45.3](https://github.com/openmake/openmake_llm/compare/v1.45.2...v1.45.3) (2026-09-06)


### 🐛 버그 수정

* **providers:** openai-compat 경로에 도구 이름 코덱 적용 — `server::tool` 을 provider 가 400 거절하던 결함 ([#769](https://github.com/openmake/openmake_llm/issues/769)) ([f325317](https://github.com/openmake/openmake_llm/commit/f325317cbe72e34e43fb8de1ef6df41740ec9afd))
* 보안 리뷰 잔여 3건 — 전역 MCP env 래핑·REST history images·dangling 심링크 ([#771](https://github.com/openmake/openmake_llm/issues/771)) ([5bd30e0](https://github.com/openmake/openmake_llm/commit/5bd30e018530c6a7ecc2dc898b4f0d734419c24b))

## [1.45.2](https://github.com/openmake/openmake_llm/compare/v1.45.1...v1.45.2) (2026-09-05)


### 🐛 버그 수정

* **memory:** 근접 중복 판정에 반복 어미 제거·수식어 불용어 추가 (라이브 실측 보강) ([#767](https://github.com/openmake/openmake_llm/issues/767)) ([f115cd7](https://github.com/openmake/openmake_llm/commit/f115cd78d9cc8a5107b8e384e8792cd2e1c8a957))

## [1.45.1](https://github.com/openmake/openmake_llm/compare/v1.45.0...v1.45.1) (2026-09-05)


### 🐛 버그 수정

* **memory:** 자동 추출 근접 중복 판정에 어미 변형 흡수 토큰 유사도 추가 ([#765](https://github.com/openmake/openmake_llm/issues/765)) ([41bd6b6](https://github.com/openmake/openmake_llm/commit/41bd6b6f3908e8acbeb23beaa7c5b1ae1c9d3bb0))

## [1.45.0](https://github.com/openmake/openmake_llm/compare/v1.44.0...v1.45.0) (2026-09-05)


### ✨ 기능

* **memory:** 메모리 관측 리포트 + LLM 추출 답변 누출 차단 (경계 태그·형식 필터) ([#763](https://github.com/openmake/openmake_llm/issues/763)) ([346cf81](https://github.com/openmake/openmake_llm/commit/346cf81a17e85bed8af51f806de6cfca26d37602))
* **memory:** 자동 추출 메모리 출처 배지 + 개수 cap 폐기 로그 ([#764](https://github.com/openmake/openmake_llm/issues/764)) ([be73429](https://github.com/openmake/openmake_llm/commit/be73429d8cbd69d35f8d149514ec0ebc11b68ba9))


### 🐛 버그 수정

* **memory:** 메모리 학습 토글 서버 authoritative·삭제 tombstone·source 라벨 정정·감사 기록 (P0 4건) ([#762](https://github.com/openmake/openmake_llm/issues/762)) ([2536b07](https://github.com/openmake/openmake_llm/commit/2536b0774164555481fd8dfd2423bbc91e0e353f))
* 이메일 주소를 openmake.cc 도메인으로 통일 ([#761](https://github.com/openmake/openmake_llm/issues/761)) ([ed74251](https://github.com/openmake/openmake_llm/commit/ed74251e8d463eaf9d461bbde8023585c7ad29b3))


### ⚡ 성능

* **chat:** 프롬프트 다이어트 1차 — MCP 비참조 서버 미노출·저빈도 도구 의도 게이팅·스킬 주입 상한 ([#755](https://github.com/openmake/openmake_llm/issues/755)) ([63ec9c0](https://github.com/openmake/openmake_llm/commit/63ec9c0f514065f66038a101dc0261681e67c6db))
* **skills:** manifest 스킬 1개 주입 상한(8000자) — 큰 스킬이 system 스킬을 밀어내던 배포 첫 실측 정정 ([#757](https://github.com/openmake/openmake_llm/issues/757)) ([32765aa](https://github.com/openmake/openmake_llm/commit/32765aa8715ae6ff6a56f556720f3bafddf5eae3))
* **skills:** system 스킬을 먼저 주입해 합계 상한에 밀려나지 않게 — [#757](https://github.com/openmake/openmake_llm/issues/757) 배포 실측 정정 ([#758](https://github.com/openmake/openmake_llm/issues/758)) ([d3aad8d](https://github.com/openmake/openmake_llm/commit/d3aad8de543fb809bd646b15e2565d1d5f0cf45d))

## [1.44.0](https://github.com/openmake/openmake_llm/compare/v1.43.1...v1.44.0) (2026-09-05)


### ✨ 기능

* **ios:** Instrument 디자인 시스템 적용 — 토큰·서체를 웹(apps/web)과 통일 ([#753](https://github.com/openmake/openmake_llm/issues/753)) ([43ea03a](https://github.com/openmake/openmake_llm/commit/43ea03a12bd47ee79bb35ce2f150ab41c0e3d387))


### 🐛 버그 수정

* **agent-task:** 로컬 실행에서 명시한 승인 정책이 'all' 로 덮어써지던 결함 수정 ([#751](https://github.com/openmake/openmake_llm/issues/751)) ([96b9e61](https://github.com/openmake/openmake_llm/commit/96b9e61a8d66c53343ff18f1d80be93abefbac69))
* **ws:** 탭 전환·앱 백그라운드로 소켓이 끊겨도 응답을 잃지 않게 — 스트림 detach/resume ([#754](https://github.com/openmake/openmake_llm/issues/754)) ([31cff3d](https://github.com/openmake/openmake_llm/commit/31cff3d37b2ad126b533d0c8ca4e75f9b24be0f6))

## [1.43.1](https://github.com/openmake/openmake_llm/compare/v1.43.0...v1.43.1) (2026-09-05)


### 🐛 버그 수정

* **providers:** NVIDIA NIM fallbackModels 를 현재 서빙 중인 모델로 교체 — 구 4개 중 3개가 EOL(410)/목록 부재 ([#749](https://github.com/openmake/openmake_llm/issues/749)) ([af66f1c](https://github.com/openmake/openmake_llm/commit/af66f1c3fde2ef03c380b8aad8ce0a751f023b01))

## [1.43.0](https://github.com/openmake/openmake_llm/compare/v1.42.0...v1.43.0) (2026-09-05)


### ✨ 기능

* **design:** Instrument 디자인 시스템 적용 — 코발트 프라이머리·시안 보조, Space Grotesk/Noto Sans KR/IBM Plex Mono ([#746](https://github.com/openmake/openmake_llm/issues/746)) ([496bbbb](https://github.com/openmake/openmake_llm/commit/496bbbb38daa4469123e3bb0f8bad1184505de0a))


### 🐛 버그 수정

* **web:** 모바일 입력 16px(iOS 포커스 확대 방지) + 터치 포인터 아이콘 버튼 히트 영역 36px ([#748](https://github.com/openmake/openmake_llm/issues/748)) ([db7d748](https://github.com/openmake/openmake_llm/commit/db7d748090b26f70e1a1801fba685d9659559a38))

## [1.42.0](https://github.com/openmake/openmake_llm/compare/v1.41.0...v1.42.0) (2026-09-04)


### ✨ 기능

* **chat:** 도구 결과 언어 리마인더 + 답변 언어 가드 관측 (한국어 질문→영어 답변 드리프트) ([#743](https://github.com/openmake/openmake_llm/issues/743)) ([af901bb](https://github.com/openmake/openmake_llm/commit/af901bb18be979bdf4f323d6aac4c7d5cdcc0135))


### 🐛 버그 수정

* **chat:** 언어 감지 전처리에서 코드 식별자 제거 — 한국어 질문이 영어로 오판되던 것 ([#745](https://github.com/openmake/openmake_llm/issues/745)) ([d67804e](https://github.com/openmake/openmake_llm/commit/d67804e271c3ec5210740eba0a2bc04276dc7cde))

## [1.41.0](https://github.com/openmake/openmake_llm/compare/v1.40.1...v1.41.0) (2026-09-04)


### ✨ 기능

* **api:** 웹 SSO 클라이언트(bench)·/v1/models 캐시 라이브 갱신·OpenAI 호환 raw 모드 ([#732](https://github.com/openmake/openmake_llm/issues/732)) ([904c17a](https://github.com/openmake/openmake_llm/commit/904c17a210cc4bdcd26a3788bda26e125b279b71))
* **mcp:** Context7 MCP 서버를 카탈로그에 시드 (114) ([#741](https://github.com/openmake/openmake_llm/issues/741)) ([da2446a](https://github.com/openmake/openmake_llm/commit/da2446a88839270a2904bc86d24818b8a23e8611))
* **mcp:** Tavily MCP 서버를 카탈로그에 시드 (112) ([#737](https://github.com/openmake/openmake_llm/issues/737)) ([547c923](https://github.com/openmake/openmake_llm/commit/547c9231455cbb1718d99105921ec28fe97ac268))
* **research:** 분해 프롬프트에 현재 날짜·검색 연산자 금지 주입 + 유효 서브토픽 관용 채택 ([#739](https://github.com/openmake/openmake_llm/issues/739)) ([22729f6](https://github.com/openmake/openmake_llm/commit/22729f6453b105b9978035a88e575eeed44da419))
* **web:** 사이드바 계정 메뉴·로그인 화면에 openmake.cc·bench 링크 추가 ([#734](https://github.com/openmake/openmake_llm/issues/734)) ([21309c7](https://github.com/openmake/openmake_llm/commit/21309c703c0c0010878b08de462e8126ab0da748))


### 🐛 버그 수정

* **deploy:** export_dotenv_for_pm2 가 스크립트 readonly 상수와 겹치는 .env 키를 건너뜀 ([#733](https://github.com/openmake/openmake_llm/issues/733)) ([c94b759](https://github.com/openmake/openmake_llm/commit/c94b759435afc014a24e7a6d2f93dde27d3354bb))
* **llm:** 로컬 모델 프로브 demote 영구 고착 해소 + 외부 모델 캐시 capabilitiesInferred 유실 수정 ([#729](https://github.com/openmake/openmake_llm/issues/729)) ([19bbd7d](https://github.com/openmake/openmake_llm/commit/19bbd7dc27178b802c4ce68fd3183a2ec7e43354))
* **providers:** B.AI deepseek 2종 무료 해제 + 잔액 부족 응답을 INSUFFICIENT_CREDIT 로 분류 ([#735](https://github.com/openmake/openmake_llm/issues/735)) ([6449bd8](https://github.com/openmake/openmake_llm/commit/6449bd8d08e19446616551711ec8152aaa5a2a76))
* **providers:** provider 정책 403 을 MODEL_ACCESS_RESTRICTED 로 분류 + 폴백 배지 사유 키 누락 수정 ([#736](https://github.com/openmake/openmake_llm/issues/736)) ([9b0bf49](https://github.com/openmake/openmake_llm/commit/9b0bf496146800a68b923809b459136051439137))
* **providers:** 추론 강도 env 맵을 기본값에 merge + deploy 가 .env 를 pm2 --update-env 에 반영 ([#731](https://github.com/openmake/openmake_llm/issues/731)) ([5f319cc](https://github.com/openmake/openmake_llm/commit/5f319cc854dd456fac7c4d2506f0fd2698d3fe56))
* **research:** 딥리서치 정합성 결함 6건 — depth 표 단일화·needsMore config 기준·REST 취소 배선·CAPACITY 정정·configure_research 사용자 격리·schema default 제거 ([#740](https://github.com/openmake/openmake_llm/issues/740)) ([d7e2c99](https://github.com/openmake/openmake_llm/commit/d7e2c991548ceba52ad9bff6d5845a2b8f89dcdf))

## [1.40.1](https://github.com/openmake/openmake_llm/compare/v1.40.0...v1.40.1) (2026-09-03)


### 🐛 버그 수정

* **llm:** 로컬 도구 루프에서 assistant reasoning 을 다음 턴에 보존 + vLLM tool_call id 보존 ([#726](https://github.com/openmake/openmake_llm/issues/726)) ([fd46f47](https://github.com/openmake/openmake_llm/commit/fd46f47ece30a04ed074a85c8ef5928d1b23176f))

## [1.40.0](https://github.com/openmake/openmake_llm/compare/v1.39.0...v1.40.0) (2026-09-03)


### ✨ 기능

* **chat:** 토론·딥리서치 명시 외부 모델 오류 계약 + 프론트 안내 정정 ([#716](https://github.com/openmake/openmake_llm/issues/716)) ([d901a35](https://github.com/openmake/openmake_llm/commit/d901a35597c24efea2b5bb52c1e242e8e22c1a09))
* **llm:** 외부 provider 실행 클라이언트 스로틀 — provider 별 동시성 + 429 지수 백오프 ([#717](https://github.com/openmake/openmake_llm/issues/717)) ([37266dc](https://github.com/openmake/openmake_llm/commit/37266dcc8b883b30f1e1f8e6d8b4ab28c5a7965b))
* **providers:** OpenAI 호환 외부 provider 에 추론 강도(reasoning_effort) 전송 — UI 낮음·보통·높음이 외부 모델에도 적용 ([#725](https://github.com/openmake/openmake_llm/issues/725)) ([972bc08](https://github.com/openmake/openmake_llm/commit/972bc084f75df3fc43fd8632ca8d81e3bf8d6b5d))


### 🐛 버그 수정

* **deep-research:** 스로틀된 외부 모델의 fan-out 동시성·타임아웃을 provider 힌트에 맞춤 ([#720](https://github.com/openmake/openmake_llm/issues/720)) ([23adfd5](https://github.com/openmake/openmake_llm/commit/23adfd584cf5be3eaf337655b07e3d6dd9b903a8))
* **llm:** external-throttle 리뷰 3건 — generate signal 인자·Retry-After 존중·429 오탐 ([#719](https://github.com/openmake/openmake_llm/issues/719)) ([6b74032](https://github.com/openmake/openmake_llm/commit/6b740323fb42b7c8c69370d285cefd30f6a7330e))
* **llm:** 로컬 vLLM 요청당 프롬프트 이미지 총량을 --limit-mm-per-prompt 상한에 맞춤 ([#722](https://github.com/openmake/openmake_llm/issues/722)) ([20abc6d](https://github.com/openmake/openmake_llm/commit/20abc6d908c21bbb77c95c83685e3693ee8faf5b))
* **llm:** 로컬 모델 샘플링 프리셋(thinking ON/OFF) + 메타 호출 think:false 명시 + thinking 기본 레벨 medium ([#724](https://github.com/openmake/openmake_llm/issues/724)) ([1902e6d](https://github.com/openmake/openmake_llm/commit/1902e6d58f4132822bd835fe298f35655f447b04))
* **llm:** 외부 스로틀 클라이언트의 SDK 타임아웃을 배수 적용 + SDK 재시도 0 ([#723](https://github.com/openmake/openmake_llm/issues/723)) ([570b150](https://github.com/openmake/openmake_llm/commit/570b150a76af465ac473522e264dbf35414500ff))
* **mcp:** {{env.KEY}} 위치 인자 비밀을 argv 에 박지 않고 sh 변수 참조로 전달 ([#714](https://github.com/openmake/openmake_llm/issues/714)) ([7bcc67f](https://github.com/openmake/openmake_llm/commit/7bcc67fcc2b2de007d0694f9b394c99982b858dd))
* **security:** 보안 리뷰 후속 3건 — REST images 상한·push 호스트 허용목록·user-sandbox realpath ([#715](https://github.com/openmake/openmake_llm/issues/715)) ([7beff99](https://github.com/openmake/openmake_llm/commit/7beff99351135973400da48030532dcbf018cab0))

## [1.39.0](https://github.com/openmake/openmake_llm/compare/v1.38.0...v1.39.0) (2026-09-02)


### ✨ 기능

* **providers:** B.AI 외부 provider 추가 — 무료 모델 5종 BYOK ([#711](https://github.com/openmake/openmake_llm/issues/711)) ([297f55a](https://github.com/openmake/openmake_llm/commit/297f55aee75a585cf7d8b05b20126e4728cf6a24))


### 🐛 버그 수정

* **providers:** 휴리스틱 추정 capability 캐시가 config 실측값을 가리지 않게 ([#713](https://github.com/openmake/openmake_llm/issues/713)) ([d857077](https://github.com/openmake/openmake_llm/commit/d857077541589e78e35ee6b1284499ec5d9cfbfe))
* **security:** push 구독 소유자를 req.user 로 고정 + endpoint SSRF 가드 ([#707](https://github.com/openmake/openmake_llm/issues/707)) ([6cc0eb2](https://github.com/openmake/openmake_llm/commit/6cc0eb24f4fcec31e55325ad6fcbfadad9afac39))
* **security:** 보안 리뷰 P0 low 4건 — CSV 수식 인젝션·MCP status 가시성·소유권 빈값·셋업 락 ([#708](https://github.com/openmake/openmake_llm/issues/708)) ([373af2c](https://github.com/openmake/openmake_llm/commit/373af2c711a6d31d5254936e7662dadb3aef3059))
* **security:** 보안 리뷰 P1 — 내부 번들 스코프·역할 게이트 실행 강제·argv 비밀 예외 명시 ([#710](https://github.com/openmake/openmake_llm/issues/710)) ([eaf022d](https://github.com/openmake/openmake_llm/commit/eaf022dfc7bafca8a2d53ef83f432014b088a24e))
* **security:** 시스템 스킬 수정·삭제와 공유 에이전트 스킬 배정에 관리자 게이트 ([#706](https://github.com/openmake/openmake_llm/issues/706)) ([40d147b](https://github.com/openmake/openmake_llm/commit/40d147b170717c2383401184d32bab5d9a6fa7d6))

## [1.38.0](https://github.com/openmake/openmake_llm/compare/v1.37.2...v1.38.0) (2026-09-02)


### ✨ 기능

* **llm:** 로컬 기본 채팅 모델 qwen3.8-27b 반영 ([#704](https://github.com/openmake/openmake_llm/issues/704)) ([37571ca](https://github.com/openmake/openmake_llm/commit/37571ca440730d404026430bd43d809be7c8f47b))
* **llm:** 로컬 모델 자동 발견 — 게이트웨이 /model/info 로 카탈로그 갱신 ([#705](https://github.com/openmake/openmake_llm/issues/705)) ([8b30fa1](https://github.com/openmake/openmake_llm/commit/8b30fa111d05057060515275fc787dd44e2ad118))
* **providers:** Open AI Service Hub(hasa) 외부 provider 추가 ([#701](https://github.com/openmake/openmake_llm/issues/701)) ([0a1c18d](https://github.com/openmake/openmake_llm/commit/0a1c18d3ae0039932f0964556bb71255705da5fa))

## [1.37.2](https://github.com/openmake/openmake_llm/compare/v1.37.1...v1.37.2) (2026-09-01)


### 🐛 버그 수정

* **eval:** response-003·030 표지 확장 — 030 은 한국어 거절 오탐 해소, 003 은 진짜 신호 확인 ([#699](https://github.com/openmake/openmake_llm/issues/699)) ([4d9b6d3](https://github.com/openmake/openmake_llm/commit/4d9b6d3b3b3cdc1f10b97172966c256e98800d35))

## [1.37.1](https://github.com/openmake/openmake_llm/compare/v1.37.0...v1.37.1) (2026-09-01)


### 🐛 버그 수정

* **eval:** response-023 라벨 결함 — 거절문 자연 표현을 금지어로 오지정 ([#695](https://github.com/openmake/openmake_llm/issues/695)) ([2464985](https://github.com/openmake/openmake_llm/commit/24649850e3eb7dead8f903ed0f47f66c30e72f61))
* **agents,eval:** 라우팅 백로그 27건 해소 + real eval 구 케이스 3건 — 골든셋 게이트 100% ([#697](https://github.com/openmake/openmake_llm/issues/697)) ([11c1bc0](https://github.com/openmake/openmake_llm/commit/11c1bc0d0a19a4677de745835866a11bd52196b0))

## [1.37.0](https://github.com/openmake/openmake_llm/compare/v1.36.0...v1.37.0) (2026-09-01)


### ✨ 기능

* **mcp:** 샌드박스 고아 컨테이너 라벨 + 부팅 스윕 ([#693](https://github.com/openmake/openmake_llm/issues/693)) ([464e585](https://github.com/openmake/openmake_llm/commit/464e585bf384ef136ce691ae3517f1d4269dbf75))

## [1.36.0](https://github.com/openmake/openmake_llm/compare/v1.35.1...v1.36.0) (2026-09-01)


### ✨ 기능

* **docs:** 한국 공문서(HWP/HWPX/HML) 지원 — kordoc 추출 + 샌드박스 툴킷 ([#683](https://github.com/openmake/openmake_llm/issues/683)) ([7fd1dc3](https://github.com/openmake/openmake_llm/commit/7fd1dc330e41432fb12f425539f3903eb4d9ca6f))
* **eval:** 골든셋 150건 확장 + 임계 ratchet + nightly 실모델 평가 ([#691](https://github.com/openmake/openmake_llm/issues/691)) ([c19de78](https://github.com/openmake/openmake_llm/commit/c19de78e977362eb786326b6b2c0c071f7e93422))
* **mcp:** 샌드박스 secure-by-default 보강 — 부팅 자세 관측 + 셋업 자동 활성화 ([#689](https://github.com/openmake/openmake_llm/issues/689)) ([8e414a0](https://github.com/openmake/openmake_llm/commit/8e414a01ec5acdbdb91f461f48251df1728b9e1b))


### 🐛 버그 수정

* **agent-task:** 턴 예산 판정에서 HWP 확장자 누락 (잠복) ([#687](https://github.com/openmake/openmake_llm/issues/687)) ([bb37532](https://github.com/openmake/openmake_llm/commit/bb37532bbada3918f18aec3e1f68913be5db10ea))
* HWP 첨부가 깨진 채 전송되던 문제 + 컨텍스트 초과 오안내 (두 겹) ([#685](https://github.com/openmake/openmake_llm/issues/685)) ([608e9a0](https://github.com/openmake/openmake_llm/commit/608e9a099d9a7710ca0419bd8842c02146ab3b9d))
* **llm:** 문자 기반 토큰 추정의 과소추정 — 임계 근처에서만 실제 토크나이저로 재계산 ([#686](https://github.com/openmake/openmake_llm/issues/686)) ([4701d6b](https://github.com/openmake/openmake_llm/commit/4701d6bfb22efb0bfd2a98dc35b32b9965b5b1c8))
* **mcp:** uvx 도구 venv 를 캐시 볼륨으로 — readonly rootfs 에서 uvx 서버 전멸 해소 ([#692](https://github.com/openmake/openmake_llm/issues/692)) ([8ee5deb](https://github.com/openmake/openmake_llm/commit/8ee5deb3ed759e93e9e996e432e49212ae46322f))

## [1.35.1](https://github.com/openmake/openmake_llm/compare/v1.35.0...v1.35.1) (2026-08-30)


### 🐛 버그 수정

* **ops:** 라우팅·TTFT 일일 집계가 로그를 못 찾던 문제 — OMK_LOG_DIR 반영 ([#681](https://github.com/openmake/openmake_llm/issues/681)) ([06abbdf](https://github.com/openmake/openmake_llm/commit/06abbdf9e57772dcdb7d8f83a735eb707375f08f))

## [1.35.0](https://github.com/openmake/openmake_llm/compare/v1.34.0...v1.35.0) (2026-08-30)


### ✨ 기능

* 유실 브랜치의 나머지 8커밋 전량 재이식 (다중 인스턴스·작업 결과 UI·포트 SSOT 등) ([#679](https://github.com/openmake/openmake_llm/issues/679)) ([5de3e3d](https://github.com/openmake/openmake_llm/commit/5de3e3d9dc4ca62280d0d73e8e1e215391972e5b))


### 🐛 버그 수정

* **agent-task:** 재시작 후 첫 작업이 user MCP 도구 0개로 돌던 결함 + 쿼터 단위 오표시 (유실 브랜치 회수) ([#677](https://github.com/openmake/openmake_llm/issues/677)) ([d4be464](https://github.com/openmake/openmake_llm/commit/d4be4640091ffa7d34a961bd48eb97e1c4ce529e))

## [1.34.0](https://github.com/openmake/openmake_llm/compare/v1.33.1...v1.34.0) (2026-08-30)


### ✨ 기능

* **agent-task-share:** 공유 산출물을 격리 오리진 뷰어로 열람 ([#644](https://github.com/openmake/openmake_llm/issues/644)) ([32f6582](https://github.com/openmake/openmake_llm/commit/32f65823f546cfbde0f1ee95471d78d15cf74f67))
* **agent-task:** goal judge 셰도우 확대 — 아티팩트 있는 완료도 판정만 기록 ([#653](https://github.com/openmake/openmake_llm/issues/653)) ([cc98d6a](https://github.com/openmake/openmake_llm/commit/cc98d6a4338ede93b462b39ef25e0f07e0580a74))
* **agent-task:** 서브에이전트 활동 기록(109) + 병렬 위임 채택률 셰도우(110)·설명문 조정 ([#647](https://github.com/openmake/openmake_llm/issues/647)) ([ba65791](https://github.com/openmake/openmake_llm/commit/ba65791ce11fc6816d61f2d4bbd218765e5e5168))
* **agent-task:** 읽기 전용 작업 공유 — 서버·웹·CLI ([#642](https://github.com/openmake/openmake_llm/issues/642)) ([4e717e8](https://github.com/openmake/openmake_llm/commit/4e717e8bc56ea1bcfbe12f8e142c1cba382ad29e))
* **cli:** openmake-code show &lt;taskId&gt; — 작업 결과·진행 기록·변경분 재출력 ([#641](https://github.com/openmake/openmake_llm/issues/641)) ([314b089](https://github.com/openmake/openmake_llm/commit/314b0894bc6121441fa58ba15dfedd1820772e59))
* **cli:** openmake-code tasks/resume/--resume — 로컬 작업 이어하기 (+취소 작업 resume 결함 수정) ([#637](https://github.com/openmake/openmake_llm/issues/637)) ([f530721](https://github.com/openmake/openmake_llm/commit/f530721b06f59af5eaaecda22fd6ad99fda6e524))
* **extensions:** 외부 스킬·플러그인 설치 시 openmake 환경 적응 (Phase 1~3) ([#607](https://github.com/openmake/openmake_llm/issues/607)) ([16a17b0](https://github.com/openmake/openmake_llm/commit/16a17b02c670b84f71a3916fe4ab17210fdec80d))
* **local-bridge:** 편집 후 진단(LSP diagnostics-first 1단계) — write 결과에 tsc/py_compile 진단 부착 ([#639](https://github.com/openmake/openmake_llm/issues/639)) ([1ccb513](https://github.com/openmake/openmake_llm/commit/1ccb51359ecec08c1d236536ab9080fef5c16b89))
* **marketplace:** 게시를 내부(갤러리)로 전환 — GitHub 로 나가지 않고 이 배포 안에서만 설치 ([#627](https://github.com/openmake/openmake_llm/issues/627)) ([a995d28](https://github.com/openmake/openmake_llm/commit/a995d2879d27349fa98957e64f7bc753241cf8c7))
* **marketplace:** 발행형 — 내가 만든 스킬·Custom Agent·MCP 설정을 플러그인 번들로 게시 (PR) ([#623](https://github.com/openmake/openmake_llm/issues/623)) ([2b8023f](https://github.com/openmake/openmake_llm/commit/2b8023f5657a76d8e629b2e5c1931e8ea4584b5c))
* **mcp:** 반복 실패 도구 서킷 차단 — 노출 제외 + 실행 거절 (P0-a PR2, 기본 OFF) ([#656](https://github.com/openmake/openmake_llm/issues/656)) ([0d67772](https://github.com/openmake/openmake_llm/commit/0d6777214bf8b182a77658bcf5bfcbeff722bff0))
* **mcp:** 서버 사용 여부 토글 — 삭제의 되돌릴 수 있는 대안 ([#617](https://github.com/openmake/openmake_llm/issues/617)) ([f6e6df2](https://github.com/openmake/openmake_llm/commit/f6e6df2e0d0514b73527eb0c38afe543f76b0926))
* **mcp:** 원격 MCP 서버 OAuth 로그인 (Authorization Code + PKCE + 동적 등록) ([#621](https://github.com/openmake/openmake_llm/issues/621)) ([7190a5b](https://github.com/openmake/openmake_llm/commit/7190a5bbe2984c205fb0fbe439969f3e654dd8a6))
* **mcp:** 클라이언트를 @modelcontextprotocol/client v2 로 이전 (Phase 1, legacy 협상 고정) ([#676](https://github.com/openmake/openmake_llm/issues/676)) ([423db6c](https://github.com/openmake/openmake_llm/commit/423db6c6e7af33921deffbe3b487412478a6f9d2))
* **metrics:** 도구별 실패율·실패 원인 관측 — 분모 있는 도구 헬스 지표 (P0-a PR1) ([#655](https://github.com/openmake/openmake_llm/issues/655)) ([00ed011](https://github.com/openmake/openmake_llm/commit/00ed011e78c4a19c064e3b9703c07b91b3f4f23e))
* **skills:** draft 확장별 묶음 + 일괄 승인·거부 ([#614](https://github.com/openmake/openmake_llm/issues/614)) ([fbb5133](https://github.com/openmake/openmake_llm/commit/fbb51332b83321dfaeecaf3db63f0f2faa39a4c9))
* **skills:** 스킬 사용 이벤트를 skill_audit_log 에 기록 + 사용 요약 API ([#671](https://github.com/openmake/openmake_llm/issues/671)) ([d4667b6](https://github.com/openmake/openmake_llm/commit/d4667b6faef59c1a4dc25c75b7243de8ca948384))
* **tools:** 한 턴 안의 읽기 전용 도구 호출을 병렬 실행 — 채팅·에이전트 작업·서브에이전트 ([#646](https://github.com/openmake/openmake_llm/issues/646)) ([75067d6](https://github.com/openmake/openmake_llm/commit/75067d6f206abd90c0ef44629c4b6ab6fd9d2fad))
* **web:** 승인 창구를 `/approvals` 한 곳으로 통합 ([#615](https://github.com/openmake/openmake_llm/issues/615)) ([646e1ab](https://github.com/openmake/openmake_llm/commit/646e1ab94013f5ce2d906f3a46aecff3aa48ae79))


### 🐛 버그 수정

* **agent-spawn:** 승인 정책 all 에서 서브에이전트가 도구 없이 답을 지어내던 것 + 인자 오류 진단 ([#645](https://github.com/openmake/openmake_llm/issues/645)) ([34ee0d6](https://github.com/openmake/openmake_llm/commit/34ee0d6d31930d65b03b7469a51a8f47e5d79340))
* **agent-task:** goal judge 사유 영속 + 증거 창에서 terminate/plan 제외 + 부분 계획 비율 제외 ([#626](https://github.com/openmake/openmake_llm/issues/626)) ([ec0be6b](https://github.com/openmake/openmake_llm/commit/ec0be6bd3c3279f24fbca1d1a35d7faff0e0aba4))
* **agent-task:** goal 의 번호 절차를 초기 계획으로 심는다 — plan 프로토콜 오류 제거 (P0-c) ([#657](https://github.com/openmake/openmake_llm/issues/657)) ([e360468](https://github.com/openmake/openmake_llm/commit/e360468f941c1563ea0a914e6a68335804fdba02))
* **agent-task:** judge 에 제출 산출물을 싣는다 — 셰도우 표본 오염 차단 ([#654](https://github.com/openmake/openmake_llm/issues/654)) ([a96dcac](https://github.com/openmake/openmake_llm/commit/a96dcac2a8e5a167586e621efebfec0fbb15372b))
* **agent-task:** 재개/재실행으로 완료된 작업에 이전 실패 사유가 남던 문제 ([#638](https://github.com/openmake/openmake_llm/issues/638)) ([78b1bf7](https://github.com/openmake/openmake_llm/commit/78b1bf70fca47bcba5f6bc712072283b7f67e512))
* **agent-task:** 재시작 시 'queued' 작업이 영구 고아가 되던 문제 + 큐 관측 엔드포인트 ([#622](https://github.com/openmake/openmake_llm/issues/622)) ([e44d49a](https://github.com/openmake/openmake_llm/commit/e44d49a88262c9ba9f22dbb3d76564b60684de8e))
* **chat:** 슬래시 스킬 호출 시 답변 언어를 스킬 본문이 아니라 사용자 질문으로 판정 ([#620](https://github.com/openmake/openmake_llm/issues/620)) ([88440a4](https://github.com/openmake/openmake_llm/commit/88440a40b1e749b34130ffc959fc5ef9dbd0d905))
* **chat:** 슬래시 스킬 확장문이 사전 웹검색·URL 분석으로 새던 문제 ([#619](https://github.com/openmake/openmake_llm/issues/619)) ([2045886](https://github.com/openmake/openmake_llm/commit/204588638108e1c032886d7cb85aaf19cb2502c7))
* **chat:** 이름에 특수문자가 있는 스킬의 슬래시 호출이 조용히 무시되던 문제 ([#613](https://github.com/openmake/openmake_llm/issues/613)) ([0af5ad5](https://github.com/openmake/openmake_llm/commit/0af5ad53a377f24a16f7a5ff1d90beab58054713))
* **deploy:** Caddyfile 을 운영 경로에 덮어쓰기 전에 caddy validate 로 검증한다 ([#662](https://github.com/openmake/openmake_llm/issues/662)) ([c24bb45](https://github.com/openmake/openmake_llm/commit/c24bb4582b0086236ea78cee72c6a8bcb102cfe9))
* **extensions:** git 심링크 SKILL.md 를 카탈로그 판정·설치 탐지에서 제외 ([#670](https://github.com/openmake/openmake_llm/issues/670)) ([4151356](https://github.com/openmake/openmake_llm/commit/4151356f346ff2d91d9e68da68f50426e6e8f2e2))
* **extensions:** 카탈로그 판정과 설치를 한 함수로 통일 — 상류 plugin.json 규격(문자열 mcpServers·skills 경로·매니페스트 선택) 수용 ([#668](https://github.com/openmake/openmake_llm/issues/668)) ([e3f82c1](https://github.com/openmake/openmake_llm/commit/e3f82c1a798daf57f96e9d6926ac69c07628486c))
* **llm:** 긴 텍스트를 JSON 으로 받는 경로 하드닝 (전수 조사 후속) ([#611](https://github.com/openmake/openmake_llm/issues/611)) ([554ca31](https://github.com/openmake/openmake_llm/commit/554ca3144885d24a0ebd344dc6ac9527a9546cf3))
* **llm:** 컨텍스트 잘림 시 첫 user 메시지(=에이전트 작업 goal) 를 앵커로 보호 ([#625](https://github.com/openmake/openmake_llm/issues/625)) ([bace734](https://github.com/openmake/openmake_llm/commit/bace734e36d7ff76ad8d9e66876f3863796e24c4))
* **llm:** 코드펜스를 먼저 벗겨 JSON 안의 코드블록을 잡던 파서 결함 ([#612](https://github.com/openmake/openmake_llm/issues/612)) ([ecee0dc](https://github.com/openmake/openmake_llm/commit/ecee0dca941b77cada2039515a00c9caba9b1856))
* **marketplace:** 번들 디렉토리 슬러그를 ASCII 로 고정 + 재게시 시 낡은 파일 정리 ([#624](https://github.com/openmake/openmake_llm/issues/624)) ([3c60105](https://github.com/openmake/openmake_llm/commit/3c6010532ef39e8cfe4a06d16acd80de534ad4b4))
* **mcp:** draft 승인 MCP 서버 자동 연결 — auto_spawn 승인 시 켜기 + 즉시 spawn + 토글/대기 중 표시 ([#628](https://github.com/openmake/openmake_llm/issues/628)) ([7dbbae5](https://github.com/openmake/openmake_llm/commit/7dbbae5a86c41b119869d7ef96e43a1f79963588))
* **mcp:** 연결 실패 원인을 화면에 드러낸다 (401 이 원인 없는 "연결 안 됨"으로 보이던 문제) ([#616](https://github.com/openmake/openmake_llm/issues/616)) ([fb55e99](https://github.com/openmake/openmake_llm/commit/fb55e997436665ed45df0a4df419a068cdb96ae1))
* **mcp:** 전역 서버 /start·/stop 가 유저풀 대신 전역 registry 로 — 소유자 불일치 500 해소 ([#629](https://github.com/openmake/openmake_llm/issues/629)) ([504ce7e](https://github.com/openmake/openmake_llm/commit/504ce7ecb5e46aa45f65a1f3114bb73a26fb6b75))
* **mcp:** 확장 유래 MCP env 자리표시자 입력 + 시크릿 암호화 + status 이중 풀 ([#659](https://github.com/openmake/openmake_llm/issues/659)) ([62fb068](https://github.com/openmake/openmake_llm/commit/62fb0683b9671d4f342ea680b2e3eb0e114b33be))
* **rate-limit:** 리미터 간 카운터 공유·프록시 IP 단일 집계로 무관한 429 가 나던 것 ([#643](https://github.com/openmake/openmake_llm/issues/643)) ([9a8d837](https://github.com/openmake/openmake_llm/commit/9a8d837b53e7f94dfef716203355f3c2c1d98ccd))
* **skills:** manifest 주입 dedupe 를 SQL 로 — 이중 배정 시 비-global 우선 + LIMIT 은 dedupe 뒤에 ([#673](https://github.com/openmake/openmake_llm/issues/673)) ([0d1da92](https://github.com/openmake/openmake_llm/commit/0d1da9269e1e22a3450b70b290beed0c6f5deea7))
* **skills:** skill_manifests 최신 version 선택을 사전순 MAX(version) 에서 semver 정렬 키로 ([#674](https://github.com/openmake/openmake_llm/issues/674)) ([cc4decb](https://github.com/openmake/openmake_llm/commit/cc4decb6ef8870c7147af160a9fc22c374026a33))
* **skills:** 배정된 스킬이 주입되지 않던 2겹 결함 — manifest 동반 생성·백필 + 명시 배정은 카테고리 무관 ([#672](https://github.com/openmake/openmake_llm/issues/672)) ([533c81c](https://github.com/openmake/openmake_llm/commit/533c81cd9a8f5fd6079ec9059095b4bc10760808))
* **skills:** 재작성 제안이 조용히 실패하던 문제 + .claude/ 경로 규칙 정교화 ([#610](https://github.com/openmake/openmake_llm/issues/610)) ([a4d37cb](https://github.com/openmake/openmake_llm/commit/a4d37cb8b89c9706e7b882bad3a582504fdd213e))
* **tools:** 없는 도구 이름 호출에 교정 후보를 붙인다 (P0-b, 축소 채택) ([#675](https://github.com/openmake/openmake_llm/issues/675)) ([721354b](https://github.com/openmake/openmake_llm/commit/721354baa97fb0821546950a1fb5944afec41f4b))
* **web-search:** 언어 미지정 호출은 질의에서 감지 — 한국어 web_search 도구 호출에 네이버·다음 provider 복원 ([#665](https://github.com/openmake/openmake_llm/issues/665)) ([8a2b8a5](https://github.com/openmake/openmake_llm/commit/8a2b8a53faf16373d3a4bcc2ecda0b91178c5266))
* **web:** 세션 만료 시 store 를 게스트로 되돌려 배지 폴링을 멈춘다 ([#649](https://github.com/openmake/openmake_llm/issues/649)) ([68798a9](https://github.com/openmake/openmake_llm/commit/68798a98a704ff6779881c985d5e6975881fa171))
* **web:** 커넥터 표 열 깨짐 — 커넥터 탭 본문 폭 확장 + 줄바꿈 금지 + 죽은 지연 열 제거 ([#630](https://github.com/openmake/openmake_llm/issues/630)) ([b51a4f5](https://github.com/openmake/openmake_llm/commit/b51a4f57ed12428253e9fc979ddf38c988645419))


### ♻️ 리팩터링

* **web:** 401/실패 시 목업 폴백 6곳 제거 + /admin/* 페이지 role 가드 ([#634](https://github.com/openmake/openmake_llm/issues/634)) ([52f3984](https://github.com/openmake/openmake_llm/commit/52f3984bffb0971705d048728dddc0f26ae2e548))
* **web:** 관리자 탭에서 '에이전트 학습'·'프롬프트 제안' 제거 (미사용) ([#635](https://github.com/openmake/openmake_llm/issues/635)) ([65d39e5](https://github.com/openmake/openmake_llm/commit/65d39e512cd9a288c3d77b9a559a3fa45140fac5))
* **web:** 관리자 페이지 전수조사 — 항상 가짜였던 목업·자기참조·이원화 정리 + 관리자 전용 라우트 /admin 하위로 ([#633](https://github.com/openmake/openmake_llm/issues/633)) ([8b530bc](https://github.com/openmake/openmake_llm/commit/8b530bc56b5f65bc85bf7ebc01de3fdfe07a0526))
* **web:** 채팅 모드 메뉴에서 자동 발동 토글 4개 제거 — 웹·이미지·아티팩트·구조화 답변 ([#648](https://github.com/openmake/openmake_llm/issues/648)) ([de445e5](https://github.com/openmake/openmake_llm/commit/de445e5e4190875c49f7165bf110e7594989a30a))
* **web:** 페이지 전수조사 기반 UI/UX 중복 제거·통합 1차 — 승인 창구 완성·설정 중복/죽은 컨트롤·목업 제거 ([#632](https://github.com/openmake/openmake_llm/issues/632)) ([634bfff](https://github.com/openmake/openmake_llm/commit/634bfff383bcaa099b198eeb92094678102e51e2))

## [1.33.1](https://github.com/openmake/openmake_llm/compare/v1.33.0...v1.33.1) (2026-08-23)


### 🐛 버그 수정

* **chatgpt:** 구조화 모드에서 ChatGPT 가 스키마를 무시하던 문제 ([b846b48](https://github.com/openmake/openmake_llm/commit/b846b4812e43eaa6b754ddfb5c9f12ee255d2c17))
* **chatgpt:** 구조화 요청의 json_schema 를 Responses API 형식으로 전달 ([5269982](https://github.com/openmake/openmake_llm/commit/526998231c9bba57e30e7a11ce4273cb2b3f2ecf))
* **chatgpt:** 추론 강도가 ChatGPT 경로에서만 무시되던 문제 ([078fe7c](https://github.com/openmake/openmake_llm/commit/078fe7c64f645584863049d3b3ac49d2974d0fbc))
* **chatgpt:** 추론 강도를 Responses API reasoning.effort 로 전달 ([448f568](https://github.com/openmake/openmake_llm/commit/448f568d63cd321f8b1d15b87a028aae634653cc))

## [1.33.0](https://github.com/openmake/openmake_llm/compare/v1.32.1...v1.33.0) (2026-08-23)


### ✨ 기능

* **chat:** 구조화 답변 degrade — json_schema 미지원·스키마 불일치에 422 로 죽지 않게 ([c94d8fd](https://github.com/openmake/openmake_llm/commit/c94d8fdccdf4cd573bfae7d5eb9a2722306b29fd))
* **chat:** 구조화 답변 degrade — json_schema 미지원·스키마 불일치에 422 로 죽지 않게 ([b6f6df8](https://github.com/openmake/openmake_llm/commit/b6f6df8561dfcd6289da9283546eac6e0416e3d1))
* **chat:** 답변 검증 — judge 모델이 1회 점검하고 지적만 표시 (자동 수정 없음) ([f564073](https://github.com/openmake/openmake_llm/commit/f564073b8cf800c3ac86da4ea8d08b1edd536fb3))
* **chat:** 답변 검증 — judge 모델이 1회 점검하고 지적만 표시 (자동 수정 없음) ([56c6a95](https://github.com/openmake/openmake_llm/commit/56c6a9594abfea46c8050e46656c3aa6ca783193))
* **chat:** 외부 provider 구조화 요청에 json_schema 전달 — 프롬프트만으로는 필드 누락 ([43456c8](https://github.com/openmake/openmake_llm/commit/43456c8b17a581de8ddcf15276c7adc132e5066a))
* **chat:** 외부 provider 구조화 요청에 json_schema 전달 — 프롬프트만으로는 필드 누락 ([c2f1c0e](https://github.com/openmake/openmake_llm/commit/c2f1c0ecc168f8aa0b2b2f040c91522ed8d3fd46))
* **chat:** 추론 강도(reasoning effort) 사용자 선택 — 채팅 UI 3단 + 모델별 정규화 ([b4471cd](https://github.com/openmake/openmake_llm/commit/b4471cdc6849bbbc4ab95e3713b53f7c7f2c0386))
* **chat:** 추론 강도(reasoning effort) 사용자 선택 — 채팅 UI 3단 + 모델별 정규화 ([c69117a](https://github.com/openmake/openmake_llm/commit/c69117abef963f33c9d9d29844adf788224602cd))
* **docs:** 목표 구조 도면 신설 — arch.png 의 짝 ([2e79bb4](https://github.com/openmake/openmake_llm/commit/2e79bb47149749d11188493b87b2e8a39393cfa9))
* **docs:** 배치 도면도 흐름이 보이도록 — 통합 도면과 같은 처리 ([59bade8](https://github.com/openmake/openmake_llm/commit/59bade844ae3d726740bfa3f5fe972abf68ed5dc))
* **docs:** 배치 도면에 기기 일러스트 — Mac mini · DGX 섀시 ([8335926](https://github.com/openmake/openmake_llm/commit/833592612c8763a53e5e155ee2f2ae3702d68a85))
* **docs:** 배치 도면을 일러스트 형식으로 다시 그림 ([bc8c258](https://github.com/openmake/openmake_llm/commit/bc8c258706ff395dce03e7059ebbb7e0fae4961c))
* **docs:** 통합 도면 시각 개편 — 흐름이 보이도록 ([6ce7007](https://github.com/openmake/openmake_llm/commit/6ce7007c3d7f7d8dbf97cd7ea392c2860473d38c))
* **docs:** 통합 도면도 같은 그림체로, 아이콘은 공용 icons.js 로 ([2ffa713](https://github.com/openmake/openmake_llm/commit/2ffa713acb29284d57eab4450ed7e612a6748ff1))
* **models:** 모델 능력 해석 SoT + 도구 호출 부팅 프로브 — 교체 시 도구 무력화 차단 ([64f3263](https://github.com/openmake/openmake_llm/commit/64f32633c942c2d3472e55f96d4e1b81b44d27de))
* **models:** 모델 능력 해석 SoT + 도구 호출 부팅 프로브 — 교체 시 도구 무력화 차단 ([1df540e](https://github.com/openmake/openmake_llm/commit/1df540efceadcf34bf2df453722d5988cd9603fd))
* **models:** 컨텍스트 길이 부팅 실측 — 262K 고정 임계 제거 ([e2d9a15](https://github.com/openmake/openmake_llm/commit/e2d9a155837131d6af89bf03052740b623c199d3))
* **models:** 컨텍스트 길이 부팅 실측 — 262K 고정 임계 제거 ([2d2049a](https://github.com/openmake/openmake_llm/commit/2d2049a9e25bef38c9d4c9c42c7b377b9306ccf9))


### 🐛 버그 수정

* **chat:** thinking 을 모델 capability 로 게이팅 — 미지원 모델 스트림 오분류 차단 ([cb98119](https://github.com/openmake/openmake_llm/commit/cb98119c05eb970cccdc52be5f6a7fc8c45aa78d))
* **chat:** thinking 을 모델 capability 로 게이팅 — 미지원 모델 스트림 오분류 차단 ([867009e](https://github.com/openmake/openmake_llm/commit/867009ed981c6ce4b70d97e1649894ae2772b0fe))
* **chat:** 구조화 답변 500 복구 — strict 스키마 재적용 + 길이 잘림 자동 회복 ([34f9a47](https://github.com/openmake/openmake_llm/commit/34f9a47816a13397992d18aeea5eff7ca05e6485))
* **chat:** 구조화 답변 500 수정 — 출력 잘림 + 교정 재시도의 system 위치 ([7115bc7](https://github.com/openmake/openmake_llm/commit/7115bc7355340f4b049a08e4850ca6f0668efc6f))
* **chat:** 구조화 출력이 길이 상한에 걸리면 스스로 줄여 재시도 ([f9f2f46](https://github.com/openmake/openmake_llm/commit/f9f2f46e0334d82b3a160908b7c1dd4d0034d4aa))
* **ci:** 파일 크기 가드 + iOS 코드젠 drift 해소 ([4e77e0f](https://github.com/openmake/openmake_llm/commit/4e77e0fcecc04a19e88fcbfe4ededdd7553634a5))
* **docs:** 도면의 provider 서술을 오늘 변경에 맞춤 ([cc44865](https://github.com/openmake/openmake_llm/commit/cc448650b5a0cb82baabea620cb54f9cca19ace4))
* **docs:** 도면의 provider 서술을 오늘 변경에 맞춤 ([e94627d](https://github.com/openmake/openmake_llm/commit/e94627de3b9246297b0a37d1390e4469015429cf))
* **llm:** reasoning_effort 를 LiteLLM 게이트웨이가 막던 문제 — 통과 힌트 동봉 ([b0b7092](https://github.com/openmake/openmake_llm/commit/b0b70925bd0d5aa95d89f8b1246a30ec3390ff2a))
* **llm:** reasoning_effort 를 LiteLLM 게이트웨이가 막던 문제 — 통과 힌트 동봉 ([12fb2f4](https://github.com/openmake/openmake_llm/commit/12fb2f40dc0876313d23daa0ddd3041b95b4cc8b))
* **llm:** repeat_penalty 가 전송되지 않던 매핑 버그 — vLLM 이름으로 정정 ([dbbb8fa](https://github.com/openmake/openmake_llm/commit/dbbb8faecdca3a6d75bb06025e213ea5f5e78740))
* **llm:** repeat_penalty 가 전송되지 않던 매핑 버그 — vLLM 이름으로 정정 ([be80303](https://github.com/openmake/openmake_llm/commit/be803039806b617590dabff2d5da48e85bfba45c))
* **schema:** 구조화 스키마를 OpenAI strict 규격으로 — 외부 모델이 필드를 빠뜨리던 원인 ([817b763](https://github.com/openmake/openmake_llm/commit/817b763a3eda3392ed9442ba9e103d27d1fff9c0))
* **schema:** 구조화 스키마를 OpenAI strict 규격으로 — 외부 모델이 필드를 빠뜨리던 원인 ([c8252e2](https://github.com/openmake/openmake_llm/commit/c8252e2bb1df4bdf364202b67f0a6229edd76b8a))
* **schema:** 구조화 스키마를 OpenAI strict 규격으로 — 외부 모델이 필드를 빠뜨리던 원인 ([63faae0](https://github.com/openmake/openmake_llm/commit/63faae0f1d3c41455f43da6368c70cccdf99475c))

## [1.32.1](https://github.com/openmake/openmake_llm/compare/v1.32.0...v1.32.1) (2026-08-23)


### 🐛 버그 수정

* **bridge:** 파일 kind FS 호출 async 전환 + 타임아웃 가드 ([c4e8906](https://github.com/openmake/openmake_llm/commit/c4e890624a874e4c51032a9c62c860ebed791122))
* **bridge:** 파일 kind FS 호출 async 전환 + 타임아웃 가드 — 블록 시 전 루트 연결 사망 해소 ([b24e36d](https://github.com/openmake/openmake_llm/commit/b24e36d6b027bcf38991143abf430f1209717c5f))

## [1.32.0](https://github.com/openmake/openmake_llm/compare/v1.31.1...v1.32.0) (2026-08-23)


### ✨ 기능

* **agent-task:** local 작업 생성 감사 기록 — OpenMake Code 축1 마감 ([#569](https://github.com/openmake/openmake_llm/issues/569)) ([5587b7a](https://github.com/openmake/openmake_llm/commit/5587b7a9d74723917999a3cfb2586ba1d3e36581))
* **bridge:** 브리지 디바이스 코어 단일화 — packages/local-bridge-core (축2 plan 1단계) ([#570](https://github.com/openmake/openmake_llm/issues/570)) ([fa8383a](https://github.com/openmake/openmake_llm/commit/fa8383a72b4d659b479253db32b3bb3dc98cfe50))
* **desktop-native:** SwiftUI 네이티브 컴패니언 1차 — 헬퍼 브리지 + 승인 다이얼로그 + 알림 딥링크 + native 업데이트 채널 ([de6e5f7](https://github.com/openmake/openmake_llm/commit/de6e5f77c81b8985a4ebf6ddc08c184f945987d8))
* **desktop-native:** SwiftUI 네이티브 컴패니언 1차 — 헬퍼 브리지·승인·알림·native 업데이트 채널 ([28c01a6](https://github.com/openmake/openmake_llm/commit/28c01a6547e1ce1f5bca499ef8d9026bd7827476))
* **desktop-native:** 다중 루트 연결 — 루트당 독립 브리지 연결(파생 deviceId) ([da6f78f](https://github.com/openmake/openmake_llm/commit/da6f78f77db80964c11fc723a450cf5d801d1d62))
* **desktop-native:** 다중 루트 연결 — 루트당 독립 브리지 연결(파생 deviceId) ([166028f](https://github.com/openmake/openmake_llm/commit/166028ffd9c548417b0ca201260235a14e503b78))
* **install:** 배포 제품화 마감 — update 서브커맨드 + 인스톨러 CI 게이트 2단 ([#573](https://github.com/openmake/openmake_llm/issues/573)) ([e2a79e0](https://github.com/openmake/openmake_llm/commit/e2a79e05f70a525b1dd58c39a553e567280442e9))
* **metrics:** 게이트 판정 관측 루프 — 라우팅 게이트 집계 + 주간 리포트 ([#564](https://github.com/openmake/openmake_llm/issues/564)) ([7a63b07](https://github.com/openmake/openmake_llm/commit/7a63b07dc7b40552acb3bcbeaacf95e932f59d89))
* **routing:** URL 단독 질의 LLM 라우팅 스킵 + 도메인 힌트 ([#567](https://github.com/openmake/openmake_llm/issues/567)) ([2ad8124](https://github.com/openmake/openmake_llm/commit/2ad81240c95ee59df5e93689cf2ab296957db578))
* **web:** 채팅 composer 첨부 버튼을 + 메뉴로 통합 — 파일 첨부/폴더 선택 ([5e62708](https://github.com/openmake/openmake_llm/commit/5e6270896e4f28ea3365392a42f73e9b24175f4b))
* **web:** 채팅 composer 첨부 버튼을 + 메뉴로 통합 — 파일 첨부/폴더 선택 ([f6e13c9](https://github.com/openmake/openmake_llm/commit/f6e13c9d114a4ea0fbc7c83fb5d0ea1bbbd613c5))


### 🐛 버그 수정

* **bridge:** untracked 하위 폴더 연결 시 worktree cwd ENOENT 해소 ([f365c90](https://github.com/openmake/openmake_llm/commit/f365c905e18ce890da41c372f1b71685a85cda4a))
* **bridge:** untracked 하위 폴더 연결 시 worktree cwd ENOENT 해소 ([7d5eb52](https://github.com/openmake/openmake_llm/commit/7d5eb52172872da8eaeb2daafb00de70b7a802e7))
* **scripts:** routing-effect 비교 스크립트 하드닝 — 상류 부재 경고·멱등·자기출력 제외 ([#571](https://github.com/openmake/openmake_llm/issues/571)) ([0bafda9](https://github.com/openmake/openmake_llm/commit/0bafda93e8ff1b8fe08a14579abc2111021507fb))


### ♻️ 리팩터링

* **api:** externalize hardcoded values per No-Hardcoding policy ([#563](https://github.com/openmake/openmake_llm/issues/563)) ([d5ffe63](https://github.com/openmake/openmake_llm/commit/d5ffe631864daecb14842d28b501e441446fd526))
* **api:** remove verified orphan files and dead code ([#561](https://github.com/openmake/openmake_llm/issues/561)) ([a8c774c](https://github.com/openmake/openmake_llm/commit/a8c774c6b3d614bc29582ac0f890141e9a8cd974))

## [1.31.1](https://github.com/openmake/openmake_llm/compare/v1.31.0...v1.31.1) (2026-08-21)


### ♻️ 리팩터링

* **chat:** external-provider 600줄 가드 분할 (594→353) ([#545](https://github.com/openmake/openmake_llm/issues/545)) ([db212b4](https://github.com/openmake/openmake_llm/commit/db212b4beef67562bbe44f6639ec0935330d365e))

## [1.31.0](https://github.com/openmake/openmake_llm/compare/v1.30.0...v1.31.0) (2026-08-21)


### ✨ 기능

* **ios:** 카메라 촬영·음성 입력 — 폰 기능 3단계 ([#557](https://github.com/openmake/openmake_llm/issues/557)) ([68d6200](https://github.com/openmake/openmake_llm/commit/68d6200e9380934b8dd22eaf7ce0ba8730f8d164))

## [1.30.0](https://github.com/openmake/openmake_llm/compare/v1.29.0...v1.30.0) (2026-08-21)


### ✨ 기능

* **ios:** 위치 컨텍스트(GPS) + 웹 로고 앱 아이콘 — 폰 기능 2단계 ([#555](https://github.com/openmake/openmake_llm/issues/555)) ([927ee6a](https://github.com/openmake/openmake_llm/commit/927ee6a5f027b7f5163afad874bc795f140bd211))

## [1.29.0](https://github.com/openmake/openmake_llm/compare/v1.28.0...v1.29.0) (2026-08-21)


### ✨ 기능

* **local-bridge:** 브리지 폴더 선택 프로토콜 — 웹에서 CLI 재시작 없이 실행 폴더 선택 ([#549](https://github.com/openmake/openmake_llm/issues/549)) ([d7c40df](https://github.com/openmake/openmake_llm/commit/d7c40dfa8cfd3121f2349265d7b48ad12cad776a))


### 🐛 버그 수정

* **local-bridge:** 로컬 실행기 준비 로그에 선택 폴더(folderRel) 기록 ([#551](https://github.com/openmake/openmake_llm/issues/551)) ([fd05e17](https://github.com/openmake/openmake_llm/commit/fd05e17f5e50ab32d175b32082c4b588528bd593))
* **web-search:** 검색 쿼리 길이 캡 — 장문 프롬프트의 provider 414 차단 ([#554](https://github.com/openmake/openmake_llm/issues/554)) ([e40291d](https://github.com/openmake/openmake_llm/commit/e40291d7328b9e11e6615c00926c245fe5ac9f49))

## [1.28.0](https://github.com/openmake/openmake_llm/compare/v1.27.0...v1.28.0) (2026-08-20)


### ✨ 기능

* **auth:** API key bridge/chat 스코프 하드닝 ([#547](https://github.com/openmake/openmake_llm/issues/547)) ([cc8a9bc](https://github.com/openmake/openmake_llm/commit/cc8a9bc56eaec9e8ae056f9e630ddb25b5a1c22d))

## [1.27.0](https://github.com/openmake/openmake_llm/compare/v1.26.0...v1.27.0) (2026-08-20)


### ✨ 기능

* **admin:** 에이전트 작업 워크플로우 관측 지표 4종 ([#540](https://github.com/openmake/openmake_llm/issues/540)) ([8e300b0](https://github.com/openmake/openmake_llm/commit/8e300b035b1dcafdc76e4540f6e92d565e720bdc))
* **agent-task:** OpenMake Code — 로컬 기반 CLI 에이전트 작업 ([#546](https://github.com/openmake/openmake_llm/issues/546)) ([8a7f0f8](https://github.com/openmake/openmake_llm/commit/8a7f0f84bbada9fcb158022c92a3e8f70640483d))


### 🐛 버그 수정

* **chat:** OpenAI 호환 클라이언트 system 메시지를 드롭 대신 맨 앞 system 에 병합 ([#543](https://github.com/openmake/openmake_llm/issues/543)) ([03b50c9](https://github.com/openmake/openmake_llm/commit/03b50c97fdac5fb5e6b148e371fd1a355caca89f))

## [1.26.0](https://github.com/openmake/openmake_llm/compare/v1.25.0...v1.26.0) (2026-08-19)


### ✨ 기능

* **agent-task:** 업로드 원본 보존 스윕 — 종료 후 N일 지난 원본 회수 ([#532](https://github.com/openmake/openmake_llm/issues/532)) ([8d5594b](https://github.com/openmake/openmake_llm/commit/8d5594ba3222e9f776aaec9fa986b73280fb0eb1))
* **auth:** iOS 축 2 — 모바일 인증 (refresh body 모드·OAuth exchange code) ([#514](https://github.com/openmake/openmake_llm/issues/514)) ([978c897](https://github.com/openmake/openmake_llm/commit/978c8975d44595917751f61e64b15d90af3d96e6))
* **chat,ios:** 모바일 답변 형식 힌트 + 긴 답변 섹션 접기 ([#520](https://github.com/openmake/openmake_llm/issues/520)) ([4589195](https://github.com/openmake/openmake_llm/commit/45891956d3d11a1bed2a5d647c85d218f1143abb))
* **chat:** PDF 첨부 vision 하이브리드 — 앞쪽 페이지 이미지 병행 주입 ([#533](https://github.com/openmake/openmake_llm/issues/533)) ([7b89f08](https://github.com/openmake/openmake_llm/commit/7b89f0813717c251bddd8a0a151d06aaaf22c066))
* **contracts:** iOS 축 1 — OpenAPI 계약 SoT·산출물·계약 테스트·CI drift 게이트 ([#512](https://github.com/openmake/openmake_llm/issues/512)) ([0ef22d8](https://github.com/openmake/openmake_llm/commit/0ef22d82051937a23b6833e725ae73ecbefbe136))
* **ios:** LUMEN 2차 백로그 — 에이전트·아티팩트·푸시·스킬 표시 ([#517](https://github.com/openmake/openmake_llm/issues/517)) ([46a8f90](https://github.com/openmake/openmake_llm/commit/46a8f90b87ac9a09a3ade689d8df1666f046b278))
* **ios:** 실기기 서명 팀 + DEBUG 시뮬레이터 스모크 훅 ([#516](https://github.com/openmake/openmake_llm/issues/516)) ([0fc8f64](https://github.com/openmake/openmake_llm/commit/0fc8f64797e4917faeac78ad26db0bcf51827167))
* **ios:** 축 3 — SwiftUI MVP 앱 (OpenMakeKit·채팅·OAuth·iOS CI) ([#515](https://github.com/openmake/openmake_llm/issues/515)) ([1c0e6ef](https://github.com/openmake/openmake_llm/commit/1c0e6efee0a6c75e6fe1ef83fa29ce456d0108d8))
* **ios:** 카카오 지도 블록을 네이티브 지도 카드로 렌더 ([#526](https://github.com/openmake/openmake_llm/issues/526)) ([b9e2f35](https://github.com/openmake/openmake_llm/commit/b9e2f3521dc315311cefd5817dcf48c01c8160bb))
* **ios:** 카카오 타일로 지도 렌더 (서버 임베드 + MapKit 폴백) ([#527](https://github.com/openmake/openmake_llm/issues/527)) ([524976c](https://github.com/openmake/openmake_llm/commit/524976cba68c5c21e5c09ed3d08e060567a12f12))
* **ios:** 표를 폰 화면용 카드로 구조화 ([#519](https://github.com/openmake/openmake_llm/issues/519)) ([fbf041d](https://github.com/openmake/openmake_llm/commit/fbf041d77830d1b39a1cda60e2f272e35005d04a))
* UI 없이 방치된 백엔드 기능 배선 + 자가개선 루프 입력 단절 수정 ([#523](https://github.com/openmake/openmake_llm/issues/523)) ([1a6813b](https://github.com/openmake/openmake_llm/commit/1a6813bbdd9ec65434fd467244f773e21441c6ac))
* **web:** 브랜드 마크 SVG 재드로잉 — 파비콘·로고 교체 ([#535](https://github.com/openmake/openmake_llm/issues/535)) ([fb11fc6](https://github.com/openmake/openmake_llm/commit/fb11fc690a421a0c7de419f68dbe5543a9cbf16d))
* **web:** 이력 카드 재배치 · 로컬 실행 시 저장소 UI 숨김 · build 자동 재시작 ([#537](https://github.com/openmake/openmake_llm/issues/537)) ([7084c6a](https://github.com/openmake/openmake_llm/commit/7084c6a69b946b0c0ff23baeb900a8f9dd255a6c))


### 🐛 버그 수정

* **agent-task:** 기본 max_turns 10 → 32 (기본값 실행의 상한 소진 실패 차단) ([#536](https://github.com/openmake/openmake_llm/issues/536)) ([524c5c2](https://github.com/openmake/openmake_llm/commit/524c5c246d04b71122171631a61a9b6f67794b8e))
* **agents:** 스킬 상시 주입 오염 — triggers 선언 스킬은 관련 턴에만 ([#522](https://github.com/openmake/openmake_llm/issues/522)) ([fa68ea1](https://github.com/openmake/openmake_llm/commit/fa68ea1b23377587d05c73b6bfdec025b0578517))
* **chat:** user MCP 도구 노출 cap 12 → 20 (예산이 실질 가드) ([#529](https://github.com/openmake/openmake_llm/issues/529)) ([d10ab67](https://github.com/openmake/openmake_llm/commit/d10ab67671804525f49164041b8620ac778b7f09))
* **ios,chat:** 아티팩트 placeholder 노출 + 파이프 없는 표 + 에이전트 작업 표시 ([#521](https://github.com/openmake/openmake_llm/issues/521)) ([ae5d9f4](https://github.com/openmake/openmake_llm/commit/ae5d9f4bc0460cf06b28026d6d32dea70141f227))
* **ios:** 이미지 응답 끊김 + 마크다운 블록 서식 ([#518](https://github.com/openmake/openmake_llm/issues/518)) ([d2bb59a](https://github.com/openmake/openmake_llm/commit/d2bb59a40b7ae5e9526f1cbcc700374c960259b6))
* **ios:** 카카오 지도 임베드를 /api/embed 로 이동 (외부 경로 404) ([#528](https://github.com/openmake/openmake_llm/issues/528)) ([c5a3ed1](https://github.com/openmake/openmake_llm/commit/c5a3ed1708ea1c46515e8bf64556714a8ff0c264))
* **mcp:** instance pid 미기록 — 헬스체크가 죽은 프로세스를 판별하지 못하던 문제 ([#524](https://github.com/openmake/openmake_llm/issues/524)) ([aa4ba2f](https://github.com/openmake/openmake_llm/commit/aa4ba2fce2582a0acb6a2cce70722e378639669d))
* **security:** SSRF allowlist 에 host:port 최소 권한 형태 추가 ([#525](https://github.com/openmake/openmake_llm/issues/525)) ([a63f5bd](https://github.com/openmake/openmake_llm/commit/a63f5bd45f15037f0fe6ba10cb21f9473ab8244a))
* **web:** iOS·PWA 아이콘 추가 + 마크 여백 축소 ([#539](https://github.com/openmake/openmake_llm/issues/539)) ([d721a3d](https://github.com/openmake/openmake_llm/commit/d721a3dd7c611c450f14351af9d18c344635d0fd))
* 모델 폴백 표기 정정 + PDF vision 해상도 상한 ([#538](https://github.com/openmake/openmake_llm/issues/538)) ([0b4c177](https://github.com/openmake/openmake_llm/commit/0b4c177f566e5fc0428ae5e5edd5b6447690d8c8))

## [1.25.0](https://github.com/openmake/openmake_llm/compare/v1.24.1...v1.25.0) (2026-08-16)


### ✨ 기능

* **extensions:** .zip 아카이브 소스 지원 — Phase 2 잔여 ([#506](https://github.com/openmake/openmake_llm/issues/506)) ([92a4eee](https://github.com/openmake/openmake_llm/commit/92a4eee08b12b37a2190a16c769a76bb972e8cf5))
* **extensions:** admin 큐레이션 카탈로그 — 등록/동기화/설치 + 설치 가능성 판정 + 탐색 UX(검색·번역) ([#507](https://github.com/openmake/openmake_llm/issues/507)) ([a4971a8](https://github.com/openmake/openmake_llm/commit/a4971a8f4c61e07184793d10fb82fee093296eda))
* **extensions:** marketplace.json 인덱스 지원 — Claude Code/Qwen 마켓플레이스 설치 ([#504](https://github.com/openmake/openmake_llm/issues/504)) ([423367d](https://github.com/openmake/openmake_llm/commit/423367d5a2b22e23d987757cf814e6bcae306dc3))
* **extensions:** Phase 2 — 버전/업데이트 확인 + 재설치 업데이트 ([#501](https://github.com/openmake/openmake_llm/issues/501)) ([adac69e](https://github.com/openmake/openmake_llm/commit/adac69e1346e02ca749f443b75bb84077830f0e9))
* **extensions:** Phase 3 — 워크스페이스 공유/갤러리 ([#502](https://github.com/openmake/openmake_llm/issues/502)) ([c9ee9c8](https://github.com/openmake/openmake_llm/commit/c9ee9c80636eaebe14f639c6b70d4e7714d49517))
* **extensions:** 확장 번들 설치 레이어 (Agent Plugins v1 호환) Phase 1 ([#499](https://github.com/openmake/openmake_llm/issues/499)) ([bfe6188](https://github.com/openmake/openmake_llm/commit/bfe6188a6ce80358fd9fcc5357a01b9c6e9a44d5))
* **skills:** git-ingest 시 skill_manifests 동시 생성 — manifest 경로 근본 개선 ([#511](https://github.com/openmake/openmake_llm/issues/511)) ([f01d943](https://github.com/openmake/openmake_llm/commit/f01d9434ce8d05b97ddc62003df2b6dce00af247))
* **web:** Settings 확장 관리 탭 — 설치 목록/구성요소 상태/번들 제거 ([#500](https://github.com/openmake/openmake_llm/issues/500)) ([5836f21](https://github.com/openmake/openmake_llm/commit/5836f21803510c9a4ff51e9af7af89ab8cb93136))


### 🐛 버그 수정

* **agent-task:** 산출물 검증 프로브 파일(.verify_*) 검사 후 정리 ([#498](https://github.com/openmake/openmake_llm/issues/498)) ([545bff5](https://github.com/openmake/openmake_llm/commit/545bff54846f381811cf07cf08ef5ed3774c9f4c))
* **extensions:** 거대 repo 스킬 설치 실패 — 위임 GitIngestService tree 상한 주입 ([#508](https://github.com/openmake/openmake_llm/issues/508)) ([4eb97c7](https://github.com/openmake/openmake_llm/commit/4eb97c79b54ff7457ca3526dfefd2a4618aed2db))
* **extensions:** 채팅 설치 UX — 의도 프리필터 강제 포함 + 마켓플레이스 오호출 자가 교정 ([#505](https://github.com/openmake/openmake_llm/issues/505)) ([1176c42](https://github.com/openmake/openmake_llm/commit/1176c426315e4bb49534aa11eeae339862ef6cc2))
* **skills:** 확장 설치 스킬 채팅 노출 4결함 — userId 전파·general 통과·manifest union ([#510](https://github.com/openmake/openmake_llm/issues/510)) ([9439a27](https://github.com/openmake/openmake_llm/commit/9439a27cf95d5e2062f6e8284bd6d1e22918c89e))
* **web:** composer 한글 IME Enter 이중 제출 가드 ([#496](https://github.com/openmake/openmake_llm/issues/496)) ([b1ad493](https://github.com/openmake/openmake_llm/commit/b1ad493452cdb899a2dfac39bea554d1685b9766))

## [1.24.1](https://github.com/openmake/openmake_llm/compare/v1.24.0...v1.24.1) (2026-08-15)


### 🐛 버그 수정

* **agent-task:** goal judge false negative 완화 — 도구 결과 증거 제공 + 계획 0완료 오용 차단 ([#494](https://github.com/openmake/openmake_llm/issues/494)) ([2dab411](https://github.com/openmake/openmake_llm/commit/2dab41125d39d01d841f3f19701ac2570a42944d))
* **chat:** 수집 목록 밖 죽은 인용 마커 결정적 제거 + done 시 화면 정리 ([#490](https://github.com/openmake/openmake_llm/issues/490)) ([542a514](https://github.com/openmake/openmake_llm/commit/542a514406dcd7fe3a0db587140c0bf1d73ea0b9))
* **chat:** 웹검색 인용 지시에 실존 출처 번호만 인용 제약 추가 (7개 언어) ([#489](https://github.com/openmake/openmake_llm/issues/489)) ([01e2569](https://github.com/openmake/openmake_llm/commit/01e2569febc283aefc9d422b328df9d51f1d57dc))
* **web,auth:** 만료-purge 된 액세스 토큰의 세션 자동 복원 — 마운트 시 refresh 선시도 ([#495](https://github.com/openmake/openmake_llm/issues/495)) ([84eaa8f](https://github.com/openmake/openmake_llm/commit/84eaa8f2e8b14c33922dc76e64259a294cc04773))
* 세션 refresh CSRF 403 원복 해소·데스크톱 exec PATH 보강(v1.8.1)·OpenWork형 사이드바 ([#493](https://github.com/openmake/openmake_llm/issues/493)) ([5943750](https://github.com/openmake/openmake_llm/commit/5943750ce68d294a7e51d36182e02aaa2e2005cd))
* 코드리뷰([#484](https://github.com/openmake/openmake_llm/issues/484) 배치) 후속 9건 수정 — OAuth 계정 바인딩 보안·검색 출처/쿼터 보강 ([#486](https://github.com/openmake/openmake_llm/issues/486)) ([6be4ca8](https://github.com/openmake/openmake_llm/commit/6be4ca889b823fc835675d3edd4eecc156d6c1eb))

## [1.24.0](https://github.com/openmake/openmake_llm/compare/v1.23.0...v1.24.0) (2026-08-14)


### ✨ 기능

* **admin:** 운영 설정 DB 이관(system_settings) + 관리자 시스템 설정 UI ([#473](https://github.com/openmake/openmake_llm/issues/473)) ([34e497d](https://github.com/openmake/openmake_llm/commit/34e497d60dfed720bb05a06baa6e8265d019af27))
* **agent-task:** 완료 판정 관문 단일화 + 판정 관측 영속(091) ([#467](https://github.com/openmake/openmake_llm/issues/467)) ([eec29e0](https://github.com/openmake/openmake_llm/commit/eec29e0977f2d4b25ba2ce01059ba6d5eedbc832))
* **chat:** 계획수립·병렬위임 의도 프리필터 — create_plan 노출 개통 + spawn 가이드 주입 ([7848246](https://github.com/openmake/openmake_llm/commit/7848246b5d3e3fccd846a3fe26c8d92d37a50cdd))
* **chat:** 발표자료 디자인 워크플로우 — OD 아티팩트 결정적 에코 + 발표 의도 위임 예외 ([#475](https://github.com/openmake/openmake_llm/issues/475)) ([f3c72d9](https://github.com/openmake/openmake_llm/commit/f3c72d90bac0fa994ac1d90190342f4f7df57992))
* **chat:** 이미지 생성 병렬화 + 스킬 required 도구 distractor 억제 면제 ([#476](https://github.com/openmake/openmake_llm/issues/476)) ([34b4ba2](https://github.com/openmake/openmake_llm/commit/34b4ba29d7261aa408d4dd427b6423892589d0d4))
* **install:** curl 원라이너 부트스트랩 + 마이그레이션 순서 수정 + uninstall.sh ([#479](https://github.com/openmake/openmake_llm/issues/479)) ([f82409d](https://github.com/openmake/openmake_llm/commit/f82409d8953498165f1b04444ee3627d8fb4fb05))
* **install:** OS 판정 선행 + Windows→WSL2 안내·순정 환경 폴백 보강 ([99d43e9](https://github.com/openmake/openmake_llm/commit/99d43e91c4d24794e2176556d25976645bbcfec4))
* **local-bridge:** 로컬 실행기 worktree 격리 + 변경분 diff 캡처 ([#469](https://github.com/openmake/openmake_llm/issues/469)) ([630bedb](https://github.com/openmake/openmake_llm/commit/630bedbc58c46d1418d120e550f42168aa01856d))
* **local-bridge:** 셸 명령 작업 단위 일괄 승인 + 레포 .git 샌드박스 쓰기 허용 ([#471](https://github.com/openmake/openmake_llm/issues/471)) ([e10710b](https://github.com/openmake/openmake_llm/commit/e10710ba15f6316235ac6826cb6ec446700c0ca2))
* **oauth:** ChatGPT OAuth 연결 직후 fail-open 자동 검증 ([#472](https://github.com/openmake/openmake_llm/issues/472)) ([79a9fda](https://github.com/openmake/openmake_llm/commit/79a9fda9094af03d158c470bebb1067f9d1587dc))
* **setup:** 부팅 시크릿 자동 생성 + 첫 실행 셋업 마법사 ([#474](https://github.com/openmake/openmake_llm/issues/474)) ([e3358e7](https://github.com/openmake/openmake_llm/commit/e3358e77cffb1c3e8ec4e72153e04bd31d13f36d))
* **task-sandbox:** 실측 기반 python 패키지 베이킹 — pandas·pdfplumber·olefile·requests ([c9bab87](https://github.com/openmake/openmake_llm/commit/c9bab872231018a2c4eb40af0b43138ffc66dcb3))
* **web:** GA4 방문자 분석 계측 — user_id 식별 + 행동 이벤트 4종, 랜딩 page_view 유실 수정 ([e10fb0e](https://github.com/openmake/openmake_llm/commit/e10fb0ef0721a5d3274e54c3c05f9c90cc71b01d))
* 미머지 로컬 배치 일괄 반영 — curl 부트스트랩·검색 provider 보강·admin 키 통합 외 수정 5건 ([#484](https://github.com/openmake/openmake_llm/issues/484)) ([48d3142](https://github.com/openmake/openmake_llm/commit/48d3142c8ce8a8210bfe4dd63141bf0a601f5740))


### 🐛 버그 수정

* **chat:** 이미지 생성 소요시간을 루프 wall-clock 예산에서 공제 ([#477](https://github.com/openmake/openmake_llm/issues/477)) ([d2786e2](https://github.com/openmake/openmake_llm/commit/d2786e23cdebaf526667b56a9f7e198717e6fc54))
* **install:** 포트 충돌 자동 회피 + 외부 접속 확인 프롬프트 ([#480](https://github.com/openmake/openmake_llm/issues/480)) ([4cefc5f](https://github.com/openmake/openmake_llm/commit/4cefc5fae7b4811fbc10ae80544ffebee2dbf948))
* **local-bridge:** worktree diff 기준점을 생성 시점 커밋으로 고정 ([#470](https://github.com/openmake/openmake_llm/issues/470)) ([8afe78b](https://github.com/openmake/openmake_llm/commit/8afe78bda95da0ef8ef5a68f8fe20e5d9af50dd1))
* **ops:** port_listening 의 조기 return 이 폴백 체인을 끊던 버그 수정 ([#483](https://github.com/openmake/openmake_llm/issues/483)) ([4495bd4](https://github.com/openmake/openmake_llm/commit/4495bd429f5bee9a1729355bebecbf6271245c0b))
* **web:** WS 직접 연결 포트 하드코딩 제거 — 포트 이동 시 연결 끊김 수정 ([#481](https://github.com/openmake/openmake_llm/issues/481)) ([81e6255](https://github.com/openmake/openmake_llm/commit/81e6255e651601ff101ada70ce987ac6f1fa9d4e))

## [1.23.0](https://github.com/openmake/openmake_llm/compare/v1.22.2...v1.23.0) (2026-08-09)


### ✨ 기능

* **admin:** history·딥리서치에도 전체 사용자 보기 토글 — 시스템 모니터링 ([47b14e7](https://github.com/openmake/openmake_llm/commit/47b14e7ce6161d6d2ec0e908826373b2a2f114aa))
* **admin:** 전체 대화 조회 서버 페이지네이션 — 상한 없이 전 대화 열람 ([abd30a7](https://github.com/openmake/openmake_llm/commit/abd30a7c536cc1dfd3175c42abb4b0de24812e5f))
* **agent-task:** admin 전체 사용자 작업 보기 토글 + 소유자 뱃지 ([5b79f7d](https://github.com/openmake/openmake_llm/commit/5b79f7da8776fc8eed65fe69caaf6955a69da218))
* **agent-task:** 실패·취소 작업 재시도(처음부터) 지원 ([9872b46](https://github.com/openmake/openmake_llm/commit/9872b464173f5b25456e152f2f8943b82e9424ed))
* **chat:** 메시지 복사·재생성 버튼 추가 ([1584bd9](https://github.com/openmake/openmake_llm/commit/1584bd9bb502c8570568b79cb0e5701717c6a925))
* **history:** 대화 본문 검색(?q=) — 제목+메시지 ILIKE, 매칭 발췌 표시 ([4c90a33](https://github.com/openmake/openmake_llm/commit/4c90a33d7b027852164b5a9c1efed676f7c9060d))
* **model-roles:** 배정 변경 감사 로그 추가 (previous 포함) ([8a2bdea](https://github.com/openmake/openmake_llm/commit/8a2bdea407c94e02d743c45efa7d4a55f35bae27))
* **model-roles:** 배정 변경 감사 로그 추가 (previous 포함) ([dce28b2](https://github.com/openmake/openmake_llm/commit/dce28b2e2a75fcbf56a0585cfdf3ea0a03fec80b))
* **usage:** 비용 환산에 집계 시작일(coverage) 명시 ([80b1aab](https://github.com/openmake/openmake_llm/commit/80b1aab419dd229443dfd7fbf895a6f100e62d9e))
* **usage:** 비용 환산에 집계 시작일(coverage) 명시 ([2c5579f](https://github.com/openmake/openmake_llm/commit/2c5579f53fb82ec397ab6f05773251660a52ba71))
* **usage:** 토큰 사용량 가상 비용 환산 — 일/월/년 ([2e9e35c](https://github.com/openmake/openmake_llm/commit/2e9e35c4dba3c921e0d23b659c4f205c32ac40af))
* **usage:** 토큰 사용량 가상 비용 환산 — 일/월/년 (실제 과금 아님) ([4d4dd14](https://github.com/openmake/openmake_llm/commit/4d4dd145716f88d88d847fbae854611ed2fdd31e))
* **web-search:** 네이버 검색 NAVER API HUB 듀얼 경로 + 무료 한도 가드 ([e3040e6](https://github.com/openmake/openmake_llm/commit/e3040e6c05b0f9087f8a0b14313ba741b3950d97))
* **web-search:** 네이버 검색 NAVER API HUB 듀얼 경로 + 일일 무료 한도 가드 ([4b57493](https://github.com/openmake/openmake_llm/commit/4b57493a61f6b8e2129cded457bc48d319d573ce))
* 사용자 만족도 개선 배치 — 메시지 재생성·작업 재시도·본문 검색 + 잔재 정리 ([4a731bc](https://github.com/openmake/openmake_llm/commit/4a731bc5e133ae755ef83e8b4bd6828238dda1f1))


### 🐛 버그 수정

* **chat:** 게스트 히스토리 즉시 반영 + 관리자 전체 대화 서버 페이지네이션 ([68e727a](https://github.com/openmake/openmake_llm/commit/68e727abb0155487c6397ee445c77e56bbf87008))
* **model-roles:** 배정 감사 previous 를 쓰기와 원자적으로 캡처 ([756becc](https://github.com/openmake/openmake_llm/commit/756beccb40b9c086862d9574e8a040e2d373f84e))
* **pricing:** 가상 비용 기본 단가를 Qwen3.8-Max 공시가로 교체 ([3896dd9](https://github.com/openmake/openmake_llm/commit/3896dd9e093cb74c7ee80fe8eca250641678273f))
* **web:** HTML 응답에 HSTS 추가 + X-Powered-By 제거 ([38a235f](https://github.com/openmake/openmake_llm/commit/38a235f00c6a68777b1bedf722dd22d1ffd375df))
* **web:** 채팅 스트림 종료 시 대화 목록 캐시 무효화 — 게스트 히스토리 즉시 반영 ([e54c587](https://github.com/openmake/openmake_llm/commit/e54c587cd54ac6c91ce1fcb2464c2369ce83d574))
* 모델 역할 배정 감사 원자성 + HTML HSTS/X-Powered-By 하드닝 ([d433490](https://github.com/openmake/openmake_llm/commit/d43349038def7f231538fd662ad9d53637edb46b))


### ♻️ 리팩터링

* **agent-task:** 라우트 헬퍼 분리 — 600줄 CI 가드 준수 ([04b4bb4](https://github.com/openmake/openmake_llm/commit/04b4bb40c5c16db56c94761b79076d1b734021ab))

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
