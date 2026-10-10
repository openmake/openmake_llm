# Changelog

## [1.93.0](https://github.com/openmake/openmake_llm/compare/v1.92.0...v1.93.0) (2026-10-10)


### ✨ 기능

* **admin:** 감사 로그 화면 사건 드롭다운에 브라우저 정책 차단 사건 추가 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** /execute 의 thinkingLevel 을 실행에 연결하고 빈 응답도 강등으로 센다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** agent_tasks.thinking_level 칸과 저장 메서드  — 184 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 관리자 작업 지표 API·화면 — 실행 방식별 성공률·소요 시간·토큰·사용자 개입 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 실행 옵션 thinkingLevel 스키마·입력 타입 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 작업 지표에 추론 수준별 집계 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 체크포인트 분기가 추론 수준도 물려받는다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 추론 강등 규칙 — 연속 실패 임계·문구·순수 함수 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 추론 수준 저장·복원 모듈 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 턴 호출이 작업의 추론 수준을 따르고 상한 초과 연속이면 강등 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **local-bridge:** 기기가 정책으로 막은 브라우저 호출을 감사 로그에 남긴다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **local-browser:** 로컬 브라우저에서 PC 파일을 사이트에 올리는 uploadFile 액션 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **local-browser:** 파일 칸을 기다리는 동안 다른 사이트로 넘어가면 업로드하지 않는다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **web:** 에이전트 모드 입력창에 추론 수준 선택 — /execute 에 thinkingLevel ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **web:** 작업 카드·상세에 추론 수준 표시, 작업 지표에 수준별 표 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))


### 🐛 버그 수정

* **admin:** 조직 정책 화면의 브라우저 사이트 정책 편집기를 조직용 문구로 표시 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 브라우저 넘겨받기 상태 조회는 넘겨받을 수 없는 작업도 200 으로 답한다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 사용자가 거절한 동작은 goal judge 판정에서 제외 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 없는 extraTools 경고는 이름마다 한 번만 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 주차 대기 상한 초과를 1분 주기로 실패 처리 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 체크포인트 분기가 원 작업의 승인 정책을 물려받는다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 추론 강등이 빈 응답·무응답 감시 발동에서도 동작한다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **agent-task:** 추론 수준 리뷰 후속 — 지표 SQL 검증·executor null·저장 실패 로그·import 정리 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** /execute·/resume 가 claimForExecute 로 동시 요청을 하나만 받게 게이트 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** API key 인증 성공 시 마지막 사용·요청 수를 기록 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** MCP 카탈로그 등록의 args·env 를 템플릿 스키마로 검증하고 제어 env 키 거부 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** 로그인 리미터가 미검증 X-API-Key 헤더로 우회되지 않게 액터 키 제한 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** 에이전트 작업 레지스트리가 두 번째 인스턴스를 거부하고 재개도 시작 시 취소를 존중 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** 에이전트 작업 실행 시작 claim 을 조건부 UPDATE 로 추가 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** 작업 큐가 같은 taskId 의 중복 제출을 duplicate 로 거부 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **api:** 카탈로그 입력 검증을 별도 모듈로 분리해 파일 길이 가드 통과 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **bridge:** exec 자식 환경을 allowlist 로 제한하고 헬퍼 API 키를 env 에서 제거 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **deps:** @modelcontextprotocol/sdk 1.32.1 로 올려 오늘 나온 high 권고 — GHSA-6qxp-vccf-f47h를 해소한다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **deps:** proxy-addr 2.0.8·source-map-js 1.2.2 로 올려 오늘 나온 audit 권고를 해소한다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **local-bridge-core:** 로딩 중 페이지의 extractText/extractHtml 결과에 loading 표시 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **local-bridge:** 인증 문제로 끊긴 브리지 연결의 사유를 앱에 보여 준다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **local-bridge:** 인증 사유로 끊긴 뒤 설정을 저장하면 같은 키라도 바로 다시 연결한다 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **web:** API 액세스 목록에 비활성 키도 불러와 다시 활성화할 수 있게 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))
* **web:** 비활성 API 키 행의 순환 단추를 비활성화 ([3e89672](https://github.com/openmake/openmake_llm/commit/3e896724ce75fc0d4ffdcfbc2b3f81e3e8be2bb5))

## [1.92.0](https://github.com/openmake/openmake_llm/compare/v1.91.0...v1.92.0) (2026-10-05)


### ✨ 기능

* **admin:** 브라우저 사이트 허용 목록 전용 편집 화면 ([ff7cfa2](https://github.com/openmake/openmake_llm/commit/ff7cfa20593778c56d37a2eeb7768c3c51c8cfdb))
* **admin:** 브라우저 사이트 허용 목록 전용 편집 화면 ([caf188a](https://github.com/openmake/openmake_llm/commit/caf188a9e81ffdbc022a950486cf38408f246dae))
* **admin:** 조직 정책 화면에서 브라우저 사이트 정책을 편집한다 ([b49ad53](https://github.com/openmake/openmake_llm/commit/b49ad533f27bf2c8fec1d3b870b107c40b7c9f73))
* **admin:** 조직 정책 화면에서 브라우저 사이트 정책을 편집한다 ([b2fb330](https://github.com/openmake/openmake_llm/commit/b2fb3305b5c46e970740441feb7a91cdaf25729c))
* **agent-task:** ask_human 이 질문 여러 개와 선택지·권장안을 한 호출로 받는다 ([f000ab9](https://github.com/openmake/openmake_llm/commit/f000ab98c37420e3b7028ffb37b4f52a241705ab))
* **agent-task:** delegate 서브에이전트 안의 승인 대기도 유예 후 주차한다 ([ced565b](https://github.com/openmake/openmake_llm/commit/ced565b0cca5b6365aca6458f2ac27e8594c1b87))
* **agent-task:** delegate 서브에이전트 안의 승인 대기도 유예 후 주차한다 ([bd81d10](https://github.com/openmake/openmake_llm/commit/bd81d10d04aee0fece65b7dba03988c286b7665b))
* **agent-task:** Docker 샌드박스에서 파일 쓰기 직후 문법을 검사한다 ([7544421](https://github.com/openmake/openmake_llm/commit/7544421533ca86c618109de5a4073de444ee20af))
* **agent-task:** fork 한 작업이 그 시점의 작업 공간 파일로 시작 (기본 꺼짐) ([b77db1e](https://github.com/openmake/openmake_llm/commit/b77db1e4a1828c5be521f1e840935e32c8a400a6))
* **agent-task:** fork 한 작업이 그 시점의 작업 공간 파일로 시작 (기본 꺼짐) ([20b27bd](https://github.com/openmake/openmake_llm/commit/20b27bd0455ffc9f6d9d0e496f13fec8a2ae7961))
* **agent-task:** skill_save 가 같은 이름이면 고쳐 쓰거나 거절하고 직전 본문을 보존한다 ([fa6f0ea](https://github.com/openmake/openmake_llm/commit/fa6f0ea49143f4b3c5c95bc3422d3bbeef835e68))
* **agent-task:** skill_save 가 저장 전에 절차 본문의 구조와 이동 주소를 검사한다 ([9a4c2fd](https://github.com/openmake/openmake_llm/commit/9a4c2fd340842f23ed9eee6ec9c097e09e8a24d8))
* **agent-task:** spawn_agents 결과 형식 계약을 기본으로 켠다 ([17bff34](https://github.com/openmake/openmake_llm/commit/17bff34484c0fba491d48f31c3128e1c55323721))
* **agent-task:** spawn_agents 태스크별 결과 형식 계약 (기본 꺼짐) ([6314a4e](https://github.com/openmake/openmake_llm/commit/6314a4eee1164fdb111133e612852d7d15907f9f))
* **agent-task:** str_replace 가 공백·따옴표 차이를 유일할 때 맞추고 실패하면 비슷한 줄을 보여 준다 ([0fb7543](https://github.com/openmake/openmake_llm/commit/0fb7543267bb8fb7a070a0e70fea94d0fcd2bf71))
* **agent-task:** 검색이 0건이면 확인된 원인을 한 줄로 알린다 ([023257f](https://github.com/openmake/openmake_llm/commit/023257fa228f4ba16bc7ea9d6291e6d2c62c4952))
* **agent-task:** 검증 증거 원장 — 변경 흔적과 그 뒤의 검증 성공 기록으로 테스트 재실행을 정한다 (기본 꺼짐) ([4b212a3](https://github.com/openmake/openmake_llm/commit/4b212a384588849bb18c49fbb35e6745ef6ac80c))
* **agent-task:** 검증을 건너뛴 완료를 verify_skipped 스텝으로 남기기 ([045ba21](https://github.com/openmake/openmake_llm/commit/045ba21283f1e67768e374b8259cb2e3eb349dbe))
* **agent-task:** 검증을 건너뛴 완료를 verify_skipped 스텝으로 남기기 ([c048589](https://github.com/openmake/openmake_llm/commit/c0485894283505f121212bdb08214aeaa92e2df2))
* **agent-task:** 검증이 보류한 답변을 턴 상한에서 버리지 않는다 ([4af7980](https://github.com/openmake/openmake_llm/commit/4af7980a47731ce2f5bb0b78c5b110fbd18659a3))
* **agent-task:** 결과 불명 호출은 사용자에게 묻고, 외부 도구는 실행 영수증·멱등 키를 남긴다 ([f2dea76](https://github.com/openmake/openmake_llm/commit/f2dea7668d70b3a2ec75e14e949ad0e9da79dc01))
* **agent-task:** 결과 형식 계약·메모리 순위·과거 작업 검색·"보고할 것 없음"을 기본으로 켠다 (실측) ([89b48bc](https://github.com/openmake/openmake_llm/commit/89b48bcbc0d054dee43efc79878a742793ed17a1))
* **agent-task:** 과거 작업 검색 도구 task_history 를 선택 기능으로 넣는다 ([d7e432d](https://github.com/openmake/openmake_llm/commit/d7e432de942422cb6684633525b83f3134ec84cb))
* **agent-task:** 과거 작업 검색 도구를 기본으로 켜되 목표가 과거 작업을 가리킬 때만 싣는다 ([2900d99](https://github.com/openmake/openmake_llm/commit/2900d99f69d827a2124f5c372b1e05849843a0fe))
* **agent-task:** 끝까지 실패한 파일 쓰기를 완료한 답변 뒤에 각주로 알린다 ([2f7e14d](https://github.com/openmake/openmake_llm/commit/2f7e14df42331512d0cba162b77f509c8d197086))
* **agent-task:** 끝난 서브에이전트 결과를 즉시 기록하고 재개 때 재사용한다 ([7a19dcd](https://github.com/openmake/openmake_llm/commit/7a19dcdd5c47ceeb31f5032a53cc30b7a2569b1f))
* **agent-task:** 누적 토큰을 매 갱신에 저장, 비용 원장에 작업 id 귀속 ([12508dd](https://github.com/openmake/openmake_llm/commit/12508dd5b1885d3bc1fc7fa96e38b66f1fda42f1))
* **agent-task:** 대기 순번과 기기 대기 안내 표시, 기기 선택기의 PC 단위 묶음 ([f9dcb7b](https://github.com/openmake/openmake_llm/commit/f9dcb7bc3e9d11d56a0678836246b3ca579ba417))
* **agent-task:** 대기열 대기 시간 지표 ([39c22f5](https://github.com/openmake/openmake_llm/commit/39c22f5f5fe63e9e66dd3d3d4527434ace3728b8))
* **agent-task:** 대기열 대기 시간 지표 — queue/stats 요약·히스토그램·가장 오래 기다린 시간 ([3860a91](https://github.com/openmake/openmake_llm/commit/3860a9161d3595ca7bcb1b6b9ef06f3aa9c7cd57))
* **agent-task:** 도구 호출 단위 반복 가드 ([d41e1a8](https://github.com/openmake/openmake_llm/commit/d41e1a8e521f9336772b92874340bf113882ec26))
* **agent-task:** 도구 호출 단위 반복 가드 ([bb32539](https://github.com/openmake/openmake_llm/commit/bb32539256867c6b6a43884d9fffecf593fd3d27))
* **agent-task:** 도구 호출 주기 반복(A-B-A-B) 감지 — 안내 뒤 차단 ([11f0351](https://github.com/openmake/openmake_llm/commit/11f0351df32150c1316849abfb17253ff2b31d79))
* **agent-task:** 도구·완료 판정 — 치환 단계적 매칭, 종료 코드 해석, 문법 검사, 구조화 질문 ([c3cf8de](https://github.com/openmake/openmake_llm/commit/c3cf8de099cf314938acf2001277a6eba8cc14a6))
* **agent-task:** 로컬 기기 대기 — 기기가 없으면 실패 대신 멈췄다가 재연결되면 이어서 실행 ([8df0217](https://github.com/openmake/openmake_llm/commit/8df0217338903e4968679b666e90ad9516613274))
* **agent-task:** 로컬 브라우저 연결과 사이트 정책 승인 ([a7e58b9](https://github.com/openmake/openmake_llm/commit/a7e58b93b80d806455fd58a762e603abac6e4254))
* **agent-task:** 로컬 실행 작업의 내부 전용 정책 — 외부 모델·외부 도구를 쓰지 않는다 ([d5ff1d1](https://github.com/openmake/openmake_llm/commit/d5ff1d1f1bdf604b0366e650f820de84f1c71799))
* **agent-task:** 로컬 토큰 비용 행에 작업 id 귀속 ([928a680](https://github.com/openmake/openmake_llm/commit/928a6803b4ef1d298129ad01b8ca8bf6a6189dd1))
* **agent-task:** 말만 하고 멈춘 턴을 첫 턴 이후에도 재촉한다 ([8305dbe](https://github.com/openmake/openmake_llm/commit/8305dbe45d0683e008832d4c55e6022c838f4f03))
* **agent-task:** 메모리 주입 순위를 기본으로 켠다 — 조사·어미 정리, 겹치는 메모리 우선, 평가 eval:memory-rank ([ca77d67](https://github.com/openmake/openmake_llm/commit/ca77d6786cd24e9de7032c082f80d7f1888eb510))
* **agent-task:** 메모리를 관련도·신뢰도·시간 감쇠 순으로 싣는 선택 기능 ([1298f97](https://github.com/openmake/openmake_llm/commit/1298f974de9ad6d0f8615ee002bd5a1ac1011bf8))
* **agent-task:** 모델 호출당 상한과 빈 응답 되묻기 ([f6e880a](https://github.com/openmake/openmake_llm/commit/f6e880a1e35e21c2d0bdb1808822c81c51762401))
* **agent-task:** 모델 호출당 상한과 빈 응답 되묻기 ([6a4fd34](https://github.com/openmake/openmake_llm/commit/6a4fd3452d7b736f8470fff8eca71a3a4dc12da5))
* **agent-task:** 모델에 닿지 못한 예약 실행은 보류했다가 다시 돌린다 ([e9c8e76](https://github.com/openmake/openmake_llm/commit/e9c8e76f8c3e3f162a06d592fec539dafe777bb6))
* **agent-task:** 무인 실행은 승인이 필요한 호출을 기다리지 않고 바로 결론낸다 ([b29cc11](https://github.com/openmake/openmake_llm/commit/b29cc112e6407a269da0749b262f606a76573b78))
* **agent-task:** 바뀌지 않은 같은 구간 다시 읽기는 2회째에 바로 안내 ([2e12bca](https://github.com/openmake/openmake_llm/commit/2e12bca897ec93da6303bb1e85f79323b7e92335))
* **agent-task:** 브라우저 도구의 이동 주소를 실행 전에 검사한다 ([30e6a9d](https://github.com/openmake/openmake_llm/commit/30e6a9dbe6797574e485b344032569dc85823ee1))
* **agent-task:** 브라우저 도구의 이동 주소를 실행 전에 검사한다 ([60e00e4](https://github.com/openmake/openmake_llm/commit/60e00e40ab347db1968cf100cba0617cc746b4c7))
* **agent-task:** 상한을 넘는 도구 결과의 앞·뒤를 남기고 생략을 알린다 ([c3df1b8](https://github.com/openmake/openmake_llm/commit/c3df1b87262ee06daa524936fbc1e2551706cad8))
* **agent-task:** 상한을 넘는 도구 결과의 앞·뒤를 남기고 생략을 알린다 ([bf08171](https://github.com/openmake/openmake_llm/commit/bf0817156621f857e49de93e2bfdd6e125462b74))
* **agent-task:** 서브에이전트 결과 예산 분배·부분 결과 표시·기록 마스킹 ([4ad5926](https://github.com/openmake/openmake_llm/commit/4ad5926bd4454bb71f8f43524bdd0a81e3b624e9))
* **agent-task:** 서브에이전트 결과 예산 분배·부분 결과 표시·기록 마스킹 ([c806431](https://github.com/openmake/openmake_llm/commit/c806431d76ccf13beecd1bbc9d146217bdf20ea7))
* **agent-task:** 서브에이전트 종료 사유를 결과마다 부모에게 싣는다 ([6e1f9d2](https://github.com/openmake/openmake_llm/commit/6e1f9d222daf6146d9ca8b5cbba8e1c741008122))
* **agent-task:** 서브에이전트가 부모 작업의 남은 토큰 예산을 넘지 않게 ([1135a03](https://github.com/openmake/openmake_llm/commit/1135a03f816bd846aedf3be524d3cd42a2d0785c))
* **agent-task:** 서브에이전트가 부모 작업의 남은 토큰 예산을 넘지 않게 ([f042a40](https://github.com/openmake/openmake_llm/commit/f042a407b7f00ee41007b963213a8e9bbd396652))
* **agent-task:** 스킬·교훈·메모리 — 휴면, 중복 저장 방지, 저장 검사, 과거 작업 검색 ([8e621ea](https://github.com/openmake/openmake_llm/commit/8e621ea807ee2b749600ce908269c4f957e35ab5))
* **agent-task:** 승인 거절 사유를 모델에 전달하고 우회 시도를 막는 문구로 변경 ([a2aa910](https://github.com/openmake/openmake_llm/commit/a2aa910a475ce24ec834eaf00cd74613ab26eb7f))
* **agent-task:** 승인 대기 주차 확대·재개 시 결과 불명 처리·LLM 끊김 재시도 ([35102f7](https://github.com/openmake/openmake_llm/commit/35102f7c4502979f36cdfaf3ee3ade6ffb2360e1))
* **agent-task:** 승인 대기 주차 확대·재개 시 결과 불명 처리·LLM 끊김 재시도 ([989f6ac](https://github.com/openmake/openmake_llm/commit/989f6acff892c9ffc1705e47279ee43cdf2a0890))
* **agent-task:** 실행 루프 밖 종료에도 알림·클라이언트의 중복 응답 처리·생성 API 문서 ([e7c2026](https://github.com/openmake/openmake_llm/commit/e7c20263119d0da6f55bf3c8a4b5274c4e48a2c6))
* **agent-task:** 실행 루프 밖 종료에도 알림·클라이언트의 중복 응답 처리·생성 API 문서 ([92e8e7a](https://github.com/openmake/openmake_llm/commit/92e8e7a5a9d7fcf0e8f2f46bfd9f93268c121c01))
* **agent-task:** 실행 소유권(lease)과 heartbeat — 죽은 서버의 작업을 이어받는다 ([08c5cc5](https://github.com/openmake/openmake_llm/commit/08c5cc5c6317084f62f870fabdd467d2bc13c967))
* **agent-task:** 실행 안정성 남은 항목 — 결과 불명 묻기·실행 영수증·소유권(lease)·진행 이벤트 재전송·중복 방지 공유 ([364da8a](https://github.com/openmake/openmake_llm/commit/364da8a9ab9a1cad8628713d3a90a93cee7f6fee))
* **agent-task:** 에이전트 작업이 사용자 메모리에 쓰는 memory_save 도구 ([7e0d107](https://github.com/openmake/openmake_llm/commit/7e0d107aadfb3d879e2f13a793dd83944013782d))
* **agent-task:** 에이전트 지시 파일 쓰기를 바닥 호출로 보호하고 경로를 정리한 뒤 비교 ([dd3cc65](https://github.com/openmake/openmake_llm/commit/dd3cc651faf96efbf03e4f606b3c2dce5e612076))
* **agent-task:** 에이전트의 브라우저를 사용자가 넘겨받아 조작한다 ([bb5af39](https://github.com/openmake/openmake_llm/commit/bb5af3988e31a38751357fcb222b6f382bba3ca1))
* **agent-task:** 연속 실패·장기 미사용 절차 스킬을 매칭 후보에서 뺀다 ([d1269c9](https://github.com/openmake/openmake_llm/commit/d1269c9930238328dea59eca48f60670aa63e957))
* **agent-task:** 예약 결과 반영·미도달 재실행·fork 정리, 가짜 모델 루프 평가 ([bf40c1f](https://github.com/openmake/openmake_llm/commit/bf40c1fd9173bf7ab7681c102ed6bc46c24f614a))
* **agent-task:** 예약 실행 결과를 예약에 반영한다 ([ae7bd77](https://github.com/openmake/openmake_llm/commit/ae7bd77fa82a64b4df574ca3a27fa34788c6a06a))
* **agent-task:** 예약 실행 겹침 건너뛰기와 발화 멱등 키 ([63fdbb4](https://github.com/openmake/openmake_llm/commit/63fdbb4d343dd63ef454e053d4fb91745502251b))
* **agent-task:** 예약 실행 겹침 건너뛰기와 발화 멱등 키 ([3891d39](https://github.com/openmake/openmake_llm/commit/3891d39121bac82b37b8d90d7468238c7e9337db))
* **agent-task:** 예약 작업의 "보고할 것 없음" 선언은 종료 알림을 생략한다 (기본 꺼짐) ([df960ce](https://github.com/openmake/openmake_llm/commit/df960cead3d6b85685722b19504fb82020c002dc))
* **agent-task:** 예약 작업의 "보고할 것 없음" 선언을 기본으로 켠다 ([ea31756](https://github.com/openmake/openmake_llm/commit/ea3175692511263fb0d98d1c3ad3968d2a33ee3c))
* **agent-task:** 오류가 아닌 종료 코드에 뜻을 덧붙인다 (grep 1·diff 1·test 1) ([df8a17a](https://github.com/openmake/openmake_llm/commit/df8a17a8e29bce1dd2c724e036e995609d8ad7b1))
* **agent-task:** 외부 도구 결과를 데이터로 감싸는 래퍼 (기본 꺼짐) ([b355a4b](https://github.com/openmake/openmake_llm/commit/b355a4bfa2980a0b22f50167369d6a559b80e4a8))
* **agent-task:** 외부 도구 결과를 데이터로 감싸는 래퍼 (기본 꺼짐) ([b832c61](https://github.com/openmake/openmake_llm/commit/b832c61d6357cbf2b8f1505a9ab72440a4c5daed))
* **agent-task:** 위임 계약 — 끝난 서브 결과 재사용, 종료 사유, 입력 품질 검사 ([057a4b6](https://github.com/openmake/openmake_llm/commit/057a4b69fe9dbfb69070c10d5df3865caefbc47e))
* **agent-task:** 위임 입력 품질 검사와 자가 보고 안내 ([31b66dc](https://github.com/openmake/openmake_llm/commit/31b66dcb89c0ee6a3ddc31fa53f055e0da051a5e))
* **agent-task:** 인자 JSON 이 깨진 도구 호출을 실행하지 않는다 ([9f5366f](https://github.com/openmake/openmake_llm/commit/9f5366ff376a0e4169499de91a2e7e9f75f5adc6))
* **agent-task:** 자동승인에서도 계속 묻는 바닥 호출을 둔다 ([269e26a](https://github.com/openmake/openmake_llm/commit/269e26a4b6bafc65da7e4b27fb15fb1ca877b507))
* **agent-task:** 작업 기록·감사 로그 90일, 화면 캡처 30일 보존 스윕 ([26e4957](https://github.com/openmake/openmake_llm/commit/26e4957d73e64701340b2097cd04786dba8d6a23))
* **agent-task:** 작업 기록·감사 로그 90일, 화면 캡처 30일 보존 스윕 ([7535757](https://github.com/openmake/openmake_llm/commit/753575734dd31a9af43de451102ccfe194743249))
* **agent-task:** 작업별 캐시 적중 프롬프트 토큰을 누적해 저장한다 ([fca8689](https://github.com/openmake/openmake_llm/commit/fca8689bfdf3ae63228be3015f5ce19095cd28e9))
* **agent-task:** 재시도 소진 뒤 더 긴 간격으로 기다린다 ([6917d17](https://github.com/openmake/openmake_llm/commit/6917d179428e8ac5067d17373ff96ba469bc7b42))
* **agent-task:** 접기 묶음 임계의 기본값을 8000자로 한다 (실측 근거) ([fe7301a](https://github.com/openmake/openmake_llm/commit/fe7301a4cf6f153e0a53ef7080cec56b12630f17))
* **agent-task:** 접기를 묶음으로 — 회수량이 임계보다 적으면 과거 메시지를 고치지 않는다 ([92b9010](https://github.com/openmake/openmake_llm/commit/92b90108889b581d802affe4b34896c7c2e23587))
* **agent-task:** 접힌 도구 결과 스텁에 명령과 성패를 남긴다 ([83857b9](https://github.com/openmake/openmake_llm/commit/83857b9a94144d0a74363cebd8bc52aa72c50b8e))
* **agent-task:** 종료 알림 유실 재전송·작업 생성 중복 방지를 DB 로 내구화 ([529c222](https://github.com/openmake/openmake_llm/commit/529c222ed3839f5c2481d252816db79f974ab93b))
* **agent-task:** 종료 알림 유실 재전송·작업 생성 중복 방지를 DB 로 내구화 ([3ca0f10](https://github.com/openmake/openmake_llm/commit/3ca0f10dd805c4138047a6dbedf76d2c37e48c1b))
* **agent-task:** 주기 반복 가드, 절단 뒤 마무리 전환, 출력 반복 대응, 다시 읽기 즉시 안내 ([245095e](https://github.com/openmake/openmake_llm/commit/245095e8e2f0ccc3f9bd39475b336fe0bf70f648))
* **agent-task:** 진행 이벤트에 순번을 붙이고 재연결 때 놓친 것을 다시 보낸다 ([49b45e7](https://github.com/openmake/openmake_llm/commit/49b45e714daea2fbeb94a6af5e1a15b308455bfa))
* **agent-task:** 창 초과 오류가 오면 대화를 줄여 같은 턴을 한 번 다시 호출한다 ([6ac6fc5](https://github.com/openmake/openmake_llm/commit/6ac6fc57db83b9a1ec33958e6d8eb1fd93200d9f))
* **agent-task:** 창 초과 판정이 도구 호출 인자·도구 스키마를 세고 실제 사용량으로 보정한다 ([f23c570](https://github.com/openmake/openmake_llm/commit/f23c57046bd26249f0c6bdb59f3803c93c23003c))
* **agent-task:** 창 초과로 메시지를 버릴 때 인계 요약을 남긴다 ([18927d8](https://github.com/openmake/openmake_llm/commit/18927d85d01807203ac2f5ba8f608c002419a6a3))
* **agent-task:** 채팅 위임 중복 방지를 DB 키로도 판정한다 ([6802052](https://github.com/openmake/openmake_llm/commit/68020529dc9e720f0e630e848da0a2f237d05b49))
* **agent-task:** 출력 반복에 대응 — 반복 뒤를 자르고 최종 답은 한 번 다시 요청 ([a59ccb1](https://github.com/openmake/openmake_llm/commit/a59ccb1e9b81dea66da0bdcc0d470d73193da46d))
* **agent-task:** 출력 반복을 작업 단계 기록에 남긴다 ([3e37f00](https://github.com/openmake/openmake_llm/commit/3e37f00c6380ffef164b2f41543ee7e632f9c0b8))
* **agent-task:** 컨텍스트 관리 — 접힌 결과 요약, 인계 요약, 토큰 추정 보정, 창 초과 복구 ([c88aeda](https://github.com/openmake/openmake_llm/commit/c88aeda3f612677e27f06dcb9595af7ebda985dc))
* **agent-task:** 컨텍스트 절단을 작업 단계 기록에 남긴다 ([f6e8f96](https://github.com/openmake/openmake_llm/commit/f6e8f96b4210c35214af4132652c7f421ad02107))
* **agent-task:** 컨텍스트 절단이 되풀이되면 마무리 턴으로 전환 ([6efe595](https://github.com/openmake/openmake_llm/commit/6efe59592aa886d259a7199a1a53ec225e0fb906))
* **agent-task:** 큰 결과 파일 보관·접기 묶음을 기본으로 켠다 (실측) ([c5c703c](https://github.com/openmake/openmake_llm/commit/c5c703c9958fcecdad9ed18cbb50062d29d0631c))
* **agent-task:** 큰 도구 결과를 작업 공간 파일로 보관한다 (기본 꺼짐) ([bafade1](https://github.com/openmake/openmake_llm/commit/bafade17b974a8f1b0348b61cccf8a1038a82c45))
* **agent-task:** 큰 도구 결과의 파일 보관을 기본으로 켠다 (실측 근거) ([60a23f3](https://github.com/openmake/openmake_llm/commit/60a23f35a24611c6ea1aecd2ef883c7d74a4eb64))
* **agent-task:** 큰 파일을 줄 구간으로 나눠 본다 ([bca8eab](https://github.com/openmake/openmake_llm/commit/bca8eab5efbd8b3078954fdb3de5af4081330c18))
* **agent-task:** 큰 파일을 줄 구간으로 나눠 본다 ([a9b6c03](https://github.com/openmake/openmake_llm/commit/a9b6c030076246d1e2bda177ef3b5b6338820ae8))
* **agent-task:** 턴 루프 복구 — 재시도 소진 뒤 대기, 행동 예고 재촉, 깨진 인자·중복 호출 처리 ([a99cd17](https://github.com/openmake/openmake_llm/commit/a99cd17b0aedb16b9580ab91513a53fbfe2d3c50))
* **agent-task:** 파이프에 가려진 실패를 단계별 종료 코드로 알린다 ([ba77a22](https://github.com/openmake/openmake_llm/commit/ba77a2231b93cf536422cb7ab36995bbddb0cad5))
* **agent-task:** 한 응답 안의 같은 읽기 호출은 한 번만 실행한다 ([5721c36](https://github.com/openmake/openmake_llm/commit/5721c36df6e15252b785ba71b41c3dae9d5d1651))
* **approvals:** skill_run 승인에 절차 체크섬 결속, 승인 카드에 절차 본문 표시 ([13519e7](https://github.com/openmake/openmake_llm/commit/13519e7863bf1f04ea721b02ad9fe65192f9bcfc))
* **approvals:** skill_run 승인에 절차 체크섬 결속, 승인 카드에 절차 본문 표시 ([3dcbd44](https://github.com/openmake/openmake_llm/commit/3dcbd442af177bec16080b67ec9147d5e550b0ed))
* **approvals:** 거절 사유 전달, 저장본 가림, 자동승인 바닥, 지시 파일 보호, 무인 실행 즉시 결론 ([85c0e82](https://github.com/openmake/openmake_llm/commit/85c0e820fa1d95a9f74177890a225404b82d55e0))
* **approvals:** 승인 요청 이벤트에 당시 승인 정책을 기록 ([b34b12b](https://github.com/openmake/openmake_llm/commit/b34b12bdfe97096239bbbbdf62a7595873429287))
* **approvals:** 승인 인자 해시 정규화, 오래된 미소비 승인 다시 묻기, 요청 이벤트에 정책 기록 ([b548ed2](https://github.com/openmake/openmake_llm/commit/b548ed29f014e7399673df3b772ff3d343db2ad2))
* **approvals:** 승인 인자 해시를 키 순서와 무관하게, 오래된 미소비 승인은 다시 묻기 ([cf76141](https://github.com/openmake/openmake_llm/commit/cf76141c2fb7623a344e840ccbc791cc45bbc3f4))
* **approvals:** 승인 카드에서 잘린 인자의 전문을 펼쳐 볼 수 있게 ([bb3a580](https://github.com/openmake/openmake_llm/commit/bb3a5801d52f7d0b0f71fed7e62a468f307eab65))
* **approvals:** 승인함과 채팅 인라인 승인에서 잘린 인자의 전문 보기 ([bbf40eb](https://github.com/openmake/openmake_llm/commit/bbf40ebff318aab4b26e15c036158ccd66900098))
* **approvals:** 채팅 인라인 승인에도 인자 전문 보기, 표시 부분을 공용 컴포넌트로 ([d0683d1](https://github.com/openmake/openmake_llm/commit/d0683d1820b3ee757e35e387b72acad8b962b7c9))
* **bridge-core:** Windows 대응 — 셸·PATH·폴더 이름, 일괄 승인 제한, 위험 명령 차단 ([76255d8](https://github.com/openmake/openmake_llm/commit/76255d8ed5d409c86eae4be1c885d77b7014eb29))
* **bridge-core:** 로컬 브라우저 — 전용 프로필 Chrome 을 CDP 로 제어하는 browser 요청 ([41d960d](https://github.com/openmake/openmake_llm/commit/41d960db9f82598248b7dcf5514af56813c8ff77))
* **bridge:** 기기 능력 목록·PC 단위 상한·요청 만료와 중복 검사·끊김 시 결과 불명 처리 ([3e797ec](https://github.com/openmake/openmake_llm/commit/3e797ece9a294e52b51c1eb066071c81a019a0b3))
* **chat:** 도구 실행 결과를 채팅 안에 카드로 보여 준다 ([687b77a](https://github.com/openmake/openmake_llm/commit/687b77ae37d9bece38cd3e231129dd63ea587796))
* **chat:** 채팅 UX 다섯 가지 — 후속 메시지 대기열, 통합 상태 표시, 자동 스크롤 금지, 도구 결과 카드, 브라우저 넘겨받기 ([e581803](https://github.com/openmake/openmake_llm/commit/e581803849157c67e02361346feec58e59cbc274))
* **chat:** 채팅 요청 중복 판정을 공유 저장소로도 선점한다 ([f33a948](https://github.com/openmake/openmake_llm/commit/f33a9484f1b4c67ecd969d8062f78c19f026319e))
* **cli:** ask_human 구조화 질문을 번호 목록으로 보여 주고 번호로 고르게 한다 ([4ec3e5c](https://github.com/openmake/openmake_llm/commit/4ec3e5c6a7cded22f5989a74c5cbe57f903ffd2c))
* **companion:** P1 — 브리지 실행 계약·기기 대기·내부 전용 정책·대기 순번 ([eaaa574](https://github.com/openmake/openmake_llm/commit/eaaa574eec1db8909a69fdf4a05e36866f7b157a))
* **companion:** P2 — 로컬 브라우저(전용 프로필 Chrome)와 사이트 정책 ([57a8689](https://github.com/openmake/openmake_llm/commit/57a8689cccc65295c44c216b9cecb6e27df06353))
* **companion:** P4 — 코어의 Windows 대응과 Windows 트레이 앱(Electron) 본체 ([890878a](https://github.com/openmake/openmake_llm/commit/890878a0be9e071f5f0b25b8a104a14b7784dfdd))
* **companion:** Windows 설치 파일 구성·업데이트 확인·게시 스크립트·설치 안내 ([29457c6](https://github.com/openmake/openmake_llm/commit/29457c60a7649d8999fe40b16465877c4c965411))
* **companion:** Windows 트레이 앱(Electron) 본체 — 폴더 연결·확인 창·알림·브라우저 제어·설정 ([8d39062](https://github.com/openmake/openmake_llm/commit/8d39062545ed730b25ce05e66792cb366cb0f2bf))
* **companion:** 로컬 브라우저 사용 설정·넘겨받기·즉시 중지 ([93f432c](https://github.com/openmake/openmake_llm/commit/93f432c6d698f33b20a0343bc66cf47085a92ee1))
* **companion:** 브라우저 넘겨받은 동안 작업을 주차해 실행 자리 반납 ([0c300b6](https://github.com/openmake/openmake_llm/commit/0c300b673a8b8488cb8d95c47133144375f7732e))
* **companion:** 브라우저 넘겨받은 동안 작업을 주차해 실행 자리 반납 ([74ab2ac](https://github.com/openmake/openmake_llm/commit/74ab2ac006d7ba72a3c62563285762bdb09d9f7d))
* **companion:** 서버 주소를 하나만 넣으면 연결·웹 주소를 서버에 물어 정한다 ([44f1db2](https://github.com/openmake/openmake_llm/commit/44f1db29e25d777e2f9da336c5e4708510d26be5))
* **companion:** 서버 주소를 하나만 넣으면 연결·웹 주소를 서버에 물어 정한다 ([59aad23](https://github.com/openmake/openmake_llm/commit/59aad238d6b53f32f8d926aee68adbd302105595))
* **config:** 브라우저 사이트 정책 판정 — 서버와 기기가 같이 쓰는 순수 로직 ([e642612](https://github.com/openmake/openmake_llm/commit/e64261279847dc64139992525fc144379bf02ed9))
* **cost:** 서브에이전트·goal judge 호출의 비용 행에도 작업 id 귀속 ([779d8c0](https://github.com/openmake/openmake_llm/commit/779d8c0c383b6c3f6c05053c57f6399ac0d04f3c))
* **cost:** 외부 모델 사용분에도 작업 id 귀속 (비용 귀속 문맥) ([b9bc1a6](https://github.com/openmake/openmake_llm/commit/b9bc1a675888b53a287ae878b5f2e00e7734f7d4))
* **deep-research:** 인용 검증에 본문을 읽은 출처와 읽지 못한 출처를 구분 ([632b6ad](https://github.com/openmake/openmake_llm/commit/632b6ad28f48e44ad058450cecbb9bcc4886fdde))
* **deep-research:** 인용 검증에 본문을 읽은 출처와 읽지 못한 출처를 구분 ([7b48ab2](https://github.com/openmake/openmake_llm/commit/7b48ab2b97cb7dcf921655209cbdd043088e7685))
* **eval:** 가드 발동 집계 스크립트 (eval:guard-stats) ([f73780b](https://github.com/openmake/openmake_llm/commit/f73780b8f58798d85dac95b2adce05ab01c4d339))
* **eval:** 가드 발동 집계, 봇 차단 패턴 실측 조정, 평가 관문 추가 ([a073142](https://github.com/openmake/openmake_llm/commit/a07314282a908d5c4801a773c9e6bba3f5161803))
* **eval:** 과제 실행기가 브라우저 과제를 돌리고 정답 문자열로 채점한다 (--browser) ([6b66c26](https://github.com/openmake/openmake_llm/commit/6b66c2637179ee52e2de529b4b5eba24bae59c1d))
* **eval:** 궤적 과정 검사의 골든 묶음·CI 관문·실제 작업 기록 검사 ([f4e7d83](https://github.com/openmake/openmake_llm/commit/f4e7d83e3dd7d8c69d967e7302f782e4c99274a6))
* **eval:** 에이전트 작업 과제 묶음 8건과 야간 회귀 감시 ([9b9b96a](https://github.com/openmake/openmake_llm/commit/9b9b96a0b668d43fe2a45a0dc886563f3e3918a3))
* **eval:** 에이전트 작업 과제 묶음 8건과 야간 회귀 감시, nightly 는 항상 DB 기록 ([b3fb986](https://github.com/openmake/openmake_llm/commit/b3fb986142b9299288237354bff71b65e58ab4a0))
* **eval:** 에이전트 작업 과제 실행기에 과제 선택 옵션 --only ([e73275b](https://github.com/openmake/openmake_llm/commit/e73275be4436f3caa8dbd57d8c91fd403326c643))
* **eval:** 에이전트 작업 궤적 과정 검사와 프롬프트 규칙 제거 실험 ([7f5017c](https://github.com/openmake/openmake_llm/commit/7f5017ca07024a9f5ffb5d021236f5c180c08e44))
* **eval:** 에이전트 작업 궤적의 결정적 과정 검사 ([f0a7c12](https://github.com/openmake/openmake_llm/commit/f0a7c12f206e2e62f6c132d22abefe526c9db4ea))
* **eval:** 프롬프트 규칙 제거 실험 실행기와 첫 측정 ([8971c84](https://github.com/openmake/openmake_llm/commit/8971c84b26dc627ff19f47ad79cca309f5ed0c81))
* fork 때 되묻기 안내 제거, 구조화 질문의 CLI·iOS 표시 ([a2288a8](https://github.com/openmake/openmake_llm/commit/a2288a860b5b211788177a379fc089b8f56ac0ea))
* **ios:** ask_human 구조화 질문을 선택지 버튼으로 보여 준다 ([14c97de](https://github.com/openmake/openmake_llm/commit/14c97de405c20d2ecac5d7a45adc018c1c0030b0))
* **llm:** 응답 usage 의 캐시 적중 프롬프트 토큰을 metrics 에 싣는다 ([60ba278](https://github.com/openmake/openmake_llm/commit/60ba2784e28c043218847e235ac8aa429da7d73d))
* **local-bridge:** 관리자 연결 기기 화면과 키 폐기 시 브리지 연결 끊기 ([c4d848b](https://github.com/openmake/openmake_llm/commit/c4d848bbbc4d561feab8a950e63e88fd9231e246))
* **local-bridge:** 관리자 연결 기기 화면과 키 폐기 시 브리지 연결 끊기 ([9845075](https://github.com/openmake/openmake_llm/commit/9845075d8314189bb70e0ffb802e894cab1e14d5))
* **model-slots:** 슬롯과 종류가 맞지 않는 로컬 모델 배정을 거절한다 ([ba795c4](https://github.com/openmake/openmake_llm/commit/ba795c45ce33eb7ce6ceef4fb2b4090246aa2c66))
* **music:** 음악 생성에 Gemini Lyria 모델을 배정할 수 있다 ([f3ea006](https://github.com/openmake/openmake_llm/commit/f3ea0062dd7d88273d1c10ee076ec072007f7ab7))
* **omk:** env install·update 가 egress 프록시 이미지도 빌드 ([c961354](https://github.com/openmake/openmake_llm/commit/c961354e80272b76b2a40cb7e80f7f73bc243534))
* **omk:** env install·update 가 egress 프록시 이미지도 빌드 ([1b5d797](https://github.com/openmake/openmake_llm/commit/1b5d79703779eddd0bd8dc17f6ae7dd77a64bcb7))
* **omk:** 스모크·결과 표지·dev → main 자동 승격 ([5a14cfa](https://github.com/openmake/openmake_llm/commit/5a14cfafcd7b6b217d2c7a32e783d85290c77979))
* **omk:** 스모크·결과 표지·dev → main 자동 승격 ([c5f4098](https://github.com/openmake/openmake_llm/commit/c5f4098fb97439e3c47ea7284523e30e269ba109))
* **orchestrator:** jev-decision 등록 + 미디어 게이트 셰도우(기록 전용) ([2edfb6c](https://github.com/openmake/openmake_llm/commit/2edfb6ce1ba4a46fb3abec72bd583ae81f3d02fa))
* **orchestrator:** jev-decision 의사결정 어댑터 등록 + 미디어 게이트 셰도우 기록 ([6b75372](https://github.com/openmake/openmake_llm/commit/6b7537284f6a8c6f1c4a99bdb616e3105876b060))
* **orchestrator:** 미디어 게이트로 Planner 생략(기본 꺼짐) ([0123264](https://github.com/openmake/openmake_llm/commit/012326414e688bcc0f58702bddec6c87b5ca02e9))
* **provider:** Google AI(Gemini API) 외부 provider 추가 ([5af2676](https://github.com/openmake/openmake_llm/commit/5af26768d2f5fd43e68a1c259a467a8811936a7f))
* **provider:** Google AI(Gemini API) 외부 provider 추가 ([b29eb4f](https://github.com/openmake/openmake_llm/commit/b29eb4f00497eddcbffb833ec66a2e5c15f3a825))
* **reliability:** 채팅 송신 백프레셔·작업 생성 중복 방지·브리지 재연결 분산 ([42266f3](https://github.com/openmake/openmake_llm/commit/42266f3d02c0f1a35e0ee2afe88e7215d6a31192))
* **reliability:** 채팅 송신 백프레셔·작업 생성 중복 방지·브리지 재연결 분산 ([53b0ac5](https://github.com/openmake/openmake_llm/commit/53b0ac504c7054014ae5bbf610b71f8dd08f5868))
* **task-sandbox:** 브라우저 결과가 봇 차단·캡차 화면으로 보이면 경고를 붙인다 ([bb9294e](https://github.com/openmake/openmake_llm/commit/bb9294e100dc2e27b99b2514953c5d3221eebcf7))
* **task-sandbox:** 브라우저 컨테이너 안 목적지 검사와 확인창 정책 ([6dbf27b](https://github.com/openmake/openmake_llm/commit/6dbf27b0c3d26fc4ac6040ecda9a52c50095b221))
* **task-sandbox:** 브라우저 컨테이너 안 목적지 검사와 확인창 정책 ([83c7862](https://github.com/openmake/openmake_llm/commit/83c7862b60a311a8c68716458347ad087be5c2a7))
* **task-sandbox:** 브라우저가 리다이렉트로 도착한 주소를 다시 검사해 막힌 주소면 결과를 주지 않는다 ([b3b294d](https://github.com/openmake/openmake_llm/commit/b3b294d883896c61f70ee3cf6432df1552e6bdf8))
* **tool-policy:** high-risk 정책에서 외부 MCP 서버 도구도 승인, 재분류 env 오류는 경고로 ([cb56ef7](https://github.com/openmake/openmake_llm/commit/cb56ef726aae9aa3b4633b76285a557d5a6bd7b4))
* **tool-policy:** high-risk 정책에서 외부 MCP 서버 도구도 승인, 재분류 env 오류는 경고로 ([860ef35](https://github.com/openmake/openmake_llm/commit/860ef355eeeaa23b033258da25e1b4cd3eded28e))
* **web-search:** 같은 사용자·같은 질의의 검색 결과를 잠시 기억하고 동시 호출을 합친다 ([589c914](https://github.com/openmake/openmake_llm/commit/589c9141f9357a9fe2bcd480e6e1f9a68dc30791))
* **web:** 과거 대화를 읽는 중에는 자동 스크롤하지 않는다 ([45c2398](https://github.com/openmake/openmake_llm/commit/45c239825a72b94a845e688af6f58eb74802e134))
* **web:** 답변 중에 보낸 메시지를 대기열에 쌓고 순서대로 보낸다 ([9b60dd3](https://github.com/openmake/openmake_llm/commit/9b60dd3b9f97321cfbf204a477541396e8f9ce1c))
* **web:** 메모리 저장 승인 카드에 저장할 문장 전문을 보인다 ([30ae4f3](https://github.com/openmake/openmake_llm/commit/30ae4f3a59c4b0aa1679ecdb0cec169eb12a3c74))
* **web:** 자동으로 꺼진 예약에 사유를 보여 준다 ([aeeb913](https://github.com/openmake/openmake_llm/commit/aeeb9133c20091aa670df81f077365d4a3b7b0e9))
* **web:** 작업 실패 사유를 분류 7종 모두 원인과 다음 행동으로 보여 준다 ([11c956d](https://github.com/openmake/openmake_llm/commit/11c956df4e9af7a228c84da6b2af0625fa4a9b93))
* **web:** 작업 카드의 토큰 아래에 캐시 적중률을 보여 준다 ([d09adad](https://github.com/openmake/openmake_llm/commit/d09adadbf1e7c52b6905ce5c507bc330bdd68e37))
* **web:** 지금 하는 일을 사이드바 한 곳에서 본다 ([a712735](https://github.com/openmake/openmake_llm/commit/a7127358c65dc0786e133ac2b5f73f5cd8ea3dea))
* **web:** 채팅 인라인 승인 카드에도 거절 사유 입력을 둔다 ([bd853df](https://github.com/openmake/openmake_llm/commit/bd853dfafd4accdb4034d6731d305a1be6e49768))
* **web:** 통합 상태 배지 중복 집계 제거, 작업 화면에서도 상세 열기, 넘겨받기 시작 주소 ([eea72fc](https://github.com/openmake/openmake_llm/commit/eea72fc1c062995c7d43a58082682f5c586da1dd))
* 브라우저 리다이렉트 재검사·컨테이너 정리, MCP 스키마·미디어 처리, 검색 메모 ([230bf27](https://github.com/openmake/openmake_llm/commit/230bf270b1f0060af92284a054343dc7ce5065be))
* 파이프에 가려진 실패 경고, 브라우저 과제 실행기 연결 ([4635706](https://github.com/openmake/openmake_llm/commit/46357061d5ac4b93942845d0eb105385a157d59c))


### 🐛 버그 수정

* **agent-task:** CI 게이트 통과 — 파일 크기 상한·iOS 생성 코드 ([3c087b4](https://github.com/openmake/openmake_llm/commit/3c087b4d4d4f29b9de55aab6a3bf2bfed2f9942d))
* **agent-task:** fork 한 작업에 모델 응답 되묻기도 따라가지 않게 한다 ([f44b976](https://github.com/openmake/openmake_llm/commit/f44b976c9064877d6478ff37d4e704dd8cd2b816))
* **agent-task:** fork 한 작업에 일회성 자원 안내가 따라가지 않게 한다 ([2d8df71](https://github.com/openmake/openmake_llm/commit/2d8df71f932f6bae071214817ce00af625d6412d))
* **agent-task:** stuck 안내를 도구 호출과 그 결과 사이에 넣지 않는다 ([76aa493](https://github.com/openmake/openmake_llm/commit/76aa49339831f51d965ff6519fc671d7123cbdfb))
* **agent-task:** 검증 증거 원장이 게이트와 같은 테스트 실행만 증거로 친다 ([cf97a10](https://github.com/openmake/openmake_llm/commit/cf97a103799eba691575158524c94e3e2d25c044))
* **agent-task:** 결과 불명 쓰기의 재실행은 사용자에게 묻고, 실패 사유·대기 순번을 채팅 카드에 표시 ([e18ac8d](https://github.com/openmake/openmake_llm/commit/e18ac8dee2e5d035282537b0c89c4caad6befa3e))
* **agent-task:** 결과 불명 쓰기의 재실행은 사용자에게 묻고, 실패 사유·대기 순번을 채팅 카드에 표시 ([cb15192](https://github.com/openmake/openmake_llm/commit/cb151923746b2b1d805c9b360f70fec8b83edfed))
* **agent-task:** 교훈 조회에서 예약 실행과 환경 탓 실패를 뺀다 ([adc3549](https://github.com/openmake/openmake_llm/commit/adc35495f718627ced9376bb4d01777710b4aeda))
* **agent-task:** 끝난 서브 결과 재사용에 만료를 둔다 (기본 6시간) ([b7c63d3](https://github.com/openmake/openmake_llm/commit/b7c63d3ab19018588670d2fb888c035e3a764e33))
* **agent-task:** 넘겨받은 브라우저에도 목적지 검사를 적용 ([7a255e2](https://github.com/openmake/openmake_llm/commit/7a255e2eb3162346c0c90abdfb53990de2abb851))
* **agent-task:** 누적 토큰을 종료 때만이 아니라 매 갱신에 저장 ([e36ae26](https://github.com/openmake/openmake_llm/commit/e36ae263a7bf052daea782a64cefbcd9c433b558))
* **agent-task:** 도구 턴 모델 호출의 무응답을 감지해 일찍 다시 시도한다 ([9fbb5de](https://github.com/openmake/openmake_llm/commit/9fbb5de85c65bbd4415ff5add58ca97579dfbb07))
* **agent-task:** 도구 턴 모델 호출의 무응답을 감지해 일찍 다시 시도한다 ([f67d3d3](https://github.com/openmake/openmake_llm/commit/f67d3d337df324cd49a39f174a528695e2625267))
* **agent-task:** 로컬 실행에서 테스트 러너 탐지가 확인 창을 띄우지 않게 ([16cbb8d](https://github.com/openmake/openmake_llm/commit/16cbb8d4fb12bdcbe0cca7953f93258d5307f56c))
* **agent-task:** 메모리 저장 도구의 노출·상한과 하위 에이전트 캐시 집계 보완 ([721a67b](https://github.com/openmake/openmake_llm/commit/721a67ba6c07ea4444ec5d70ed77b89c60b9a877))
* **agent-task:** 메모리 저장 도구의 노출·상한과 하위 에이전트 캐시 집계 보완 ([600ef36](https://github.com/openmake/openmake_llm/commit/600ef365da01472b79f6d559ed9a06e2c6a57431))
* **agent-task:** 무응답 감시가 걸린 호출에는 호출 상한을 적용하지 않는다 ([5cafbc9](https://github.com/openmake/openmake_llm/commit/5cafbc9d261dad459fcb5bd5577c59c5d9073123))
* **agent-task:** 무응답 기한의 절반을 넘긴 청크 간격을 경고로 남긴다 ([60b293f](https://github.com/openmake/openmake_llm/commit/60b293fadf7e32d7ea253e522504390301eaccdc))
* **agent-task:** 사용자가 요청한 반복 출력은 자르지 않게 ([b79604e](https://github.com/openmake/openmake_llm/commit/b79604e3c2f7da40997ccd36e8fd8fd9a25e2ad7))
* **agent-task:** 샌드박스를 받지 못한 작업을 조용히 진행시키지 않는다 ([ebb665b](https://github.com/openmake/openmake_llm/commit/ebb665b0c917ef7d9962958dba83115db71b5dc8))
* **agent-task:** 샌드박스를 받지 못한 작업을 조용히 진행시키지 않는다 ([991ecc7](https://github.com/openmake/openmake_llm/commit/991ecc703a2e78c55389f0725846ffada6a2a216))
* **agent-task:** 서브에이전트 승인 대기를 목록·부모 상태에 반영한다 ([652ee19](https://github.com/openmake/openmake_llm/commit/652ee19f0418c6844b8af198ec70b38e3de2c462))
* **agent-task:** 서브에이전트 응답 언어를 이름으로 짚는다 ([d55b839](https://github.com/openmake/openmake_llm/commit/d55b839f2a7b42c44b1fc517f7dd263fef75aac2))
* **agent-task:** 서브에이전트 응답 언어를 이름으로 짚는다 ([82ae0fc](https://github.com/openmake/openmake_llm/commit/82ae0fcfc9a4e0de57f1773a70d168a6c5988ef2))
* **agent-task:** 서브에이전트에 쓸 수 있는 도구 범위를 알린다 ([edaa8c2](https://github.com/openmake/openmake_llm/commit/edaa8c260c80ebe51506c0f9d58454eded9ca0ed))
* **agent-task:** 서브에이전트에 쓸 수 있는 도구 범위를 알린다 ([3de041f](https://github.com/openmake/openmake_llm/commit/3de041f954096ef5eb4f876053f9af031c41f128))
* **agent-task:** 설치본에서 작업 파일 다운로드가 404 로 떨어지던 문제 ([cfaec85](https://github.com/openmake/openmake_llm/commit/cfaec8520ec549b45f8ca8f46d9242be2691b012))
* **agent-task:** 설치본에서 작업 파일 다운로드가 404 로 떨어지던 문제 ([df00de9](https://github.com/openmake/openmake_llm/commit/df00de911c10fb8a92ca8201f811abc01c6a9726))
* **agent-task:** 승인 대기로 주차될 때 넘겨받은 브라우저 세션을 내리지 않는다 ([25b8402](https://github.com/openmake/openmake_llm/commit/25b84023981b62fb4f64027c76818f564a99298f))
* **agent-task:** 승인 저장본 가림을 낱말 단위로 좁혀 승인할 내용이 보이게 한다 ([b0ac38c](https://github.com/openmake/openmake_llm/commit/b0ac38c7e74a91e1292f1dbb622a0fa27a4dc17b))
* **agent-task:** 승인 저장본의 비밀 값을 가린다 ([e311234](https://github.com/openmake/openmake_llm/commit/e3112343a3d4699c3f8517551f8ccd03dc887a14))
* **agent-task:** 위임 입력 검사의 최소 길이를 한글·한자·가나에 맞춘다 ([4ff01de](https://github.com/openmake/openmake_llm/commit/4ff01deb6e83e9ac088022b9691fc148912210a9))
* **agent-task:** 위임 최소 글자 한국어 보정, 자가 보고 문구, 재사용 만료, 인계 요약 뒤 사용 도구 복원 ([3eb130b](https://github.com/openmake/openmake_llm/commit/3eb130b9f2d756b5357a1fb0d35788637668eccd))
* **agent-task:** 인계 요약 뒤 재개해도 사용 도구가 복원된다 ([68ab050](https://github.com/openmake/openmake_llm/commit/68ab0506236e17fdbbbd198bcc73c0754c9558bf))
* **agent-task:** 자가 보고 안내가 추가 도구 호출을 유도하지 않게 한다 ([8d714c4](https://github.com/openmake/openmake_llm/commit/8d714c490356d503e8849b6a4b02f5a16eea9844))
* **agent-task:** 자동 승인 모드에서 로컬 브라우저의 읽기는 묻지 않는다 ([11e942c](https://github.com/openmake/openmake_llm/commit/11e942c8dee91faf5888f95c953ae1642859b473))
* **agent-task:** 자동 승인 모드에서 로컬 브라우저의 읽기는 묻지 않는다 ([bdb1dfc](https://github.com/openmake/openmake_llm/commit/bdb1dfc48f91d4f913774172e9ee7f4da2fe64a9))
* **agent-task:** 작업 도중 지시로 요청한 반복 출력도 자르지 않게 ([ff4657c](https://github.com/openmake/openmake_llm/commit/ff4657cf8a8b970b2e822aedc41b943a6b20f551))
* **agent-task:** 작업 변경분에 제품 내부 파일이 섞이지 않게 한다 ([ccdf4dc](https://github.com/openmake/openmake_llm/commit/ccdf4dc68066d236119c5059a50cefcc9f5be6f7))
* **agent-task:** 재개 뒤 검증 누락, fork 안내, ask_human 설명 ([a148c84](https://github.com/openmake/openmake_llm/commit/a148c84575f6bda02d3efbbe058e3a70152e2d3f))
* **agent-task:** 재개 뒤 검증 누락, fork 안내, ask_human 설명 ([3b2a05b](https://github.com/openmake/openmake_llm/commit/3b2a05bfee1461df14caa61d6ad6e91b2a02e894))
* **agent-task:** 재개 때 승인 정책 유지, 기기 대기·사이트 쓰기를 화면에 표시 ([3889cd5](https://github.com/openmake/openmake_llm/commit/3889cd5ad0a74dfa2a1c82c87cd3b99a2d5ddd36))
* **agent-task:** 재개 때 승인 정책 유지, 기기 대기·사이트 쓰기를 화면에 표시 ([ebafc90](https://github.com/openmake/openmake_llm/commit/ebafc9006b1e2914140a5d3691d63ad367e5a10b))
* **agent-task:** 절차 스킬 평문 저장·사용 기록 중복·목록 섞임 ([02dfa66](https://github.com/openmake/openmake_llm/commit/02dfa668f9306d532fb7d5b299b8ed1fc33d769a))
* **agent-task:** 절차 스킬 평문 저장·사용 기록 중복·목록 섞임 ([5c0ba28](https://github.com/openmake/openmake_llm/commit/5c0ba28244dca28dbad1875542313ae70e8e7bad))
* **agent-task:** 접기 묶음으로 미뤄 둔 접기가 있으면 창 초과 때 요약으로 버리기 전에 먼저 접는다 ([aa4206d](https://github.com/openmake/openmake_llm/commit/aa4206d2fa87cad2667c0e11efc2c9927b271bf8))
* **agent-task:** 중간 지시가 온 바로 그 턴부터 memory_save 를 보여 준다 ([51a90e3](https://github.com/openmake/openmake_llm/commit/51a90e3115d4e5f21e780fca5150413f2a32f8e0))
* **agent-task:** 파일로 보관한 도구 결과를 접어도 보관 경로를 스텁에 남긴다 ([81e6116](https://github.com/openmake/openmake_llm/commit/81e61168ab6f7a6bf2d3c6e071e28fea94034d80))
* **approvals:** 승인 저장본 가림 범위를 좁히고 인라인 승인에 거절 사유 입력 추가 ([2791b45](https://github.com/openmake/openmake_llm/commit/2791b4547ce4e9217af819a708dfa1616ba5bf1c))
* **chat:** 답변 중 새 대화를 열면 생성을 멈추고, 거절된 요청(400)의 안내 문구를 바로잡는다 ([edf423f](https://github.com/openmake/openmake_llm/commit/edf423fcc96baeaefbb12c48d28d7dce52e2cd21))
* **chat:** 소켓 핸들러 파일 크기 상한(600줄) 맞춤 ([0483cad](https://github.com/openmake/openmake_llm/commit/0483cadde68e72b8d4ae31a3a70140ccc0f81716))
* **chat:** 업스트림이 요청을 거절한 400 은 로컬로 폴백하지 않는다 ([8873e2d](https://github.com/openmake/openmake_llm/commit/8873e2d053b861330c34af6fa6c43ea037fb2e00))
* **ci:** iOS 가 문자열·객체 두 가지 summary 를 받게 하고, 넘겨받기 라우트 테스트의 대기를 응답 기준으로 바꾼다 ([6a0167c](https://github.com/openmake/openmake_llm/commit/6a0167cc1bf877579f2d9882506f9e25ae4e29d3))
* **cli:** 레포가 아닌 폴더에서 git 오류 문구가 터미널에 찍히지 않게 ([6bfba0c](https://github.com/openmake/openmake_llm/commit/6bfba0cb6d59241754eac39930d6257bec5f2a1b))
* **db:** 기본 MCP 서버(noapi-google-search)를 꺼진 채로 심는다 ([4518481](https://github.com/openmake/openmake_llm/commit/45184819a4130c9b16f480268090ee12b56b311e))
* **deploy:** 기본 포트가 아닌 설치본에서 생성 이미지가 500 이던 문제 ([215b43a](https://github.com/openmake/openmake_llm/commit/215b43ab91364d93abe328bfa831148c706ca020))
* **deploy:** 기본 포트가 아닌 설치본에서 생성 이미지가 500 이던 문제 ([141c88e](https://github.com/openmake/openmake_llm/commit/141c88e7c9750f45162cc4eb21cd0663e02e684a))
* **deps:** @grpc/grpc-js 1.14.5 로 올려 audit 게이트 통과 ([34d3936](https://github.com/openmake/openmake_llm/commit/34d39361dcdef07c7d36356e9592d080e50e718d))
* **deps:** @grpc/grpc-js 1.14.5 로 올려 audit 게이트 통과 (GHSA-m9gg-hp2v-232j) ([a9957f8](https://github.com/openmake/openmake_llm/commit/a9957f8410b9c44aa845add8d5d8166b88eddaea))
* **desktop-native:** dmg 생성이 간헐 실패하면 다시 시도한다 ([27f0cc2](https://github.com/openmake/openmake_llm/commit/27f0cc2f8b2fd63d8ab06c0856bed3f21450c77b))
* **desktop-native:** 빌드 버전을 게시본보다 높게 맞추고, 쓸 수 없는 위치에서는 업데이트를 받지 않는다 ([32b1465](https://github.com/openmake/openmake_llm/commit/32b14651193b3487f282f9fad5b805a8a91b653a))
* **desktop-native:** 빌드 버전을 게시본보다 높게 맞추고, 쓸 수 없는 위치에서는 업데이트를 받지 않는다 ([f90b2a0](https://github.com/openmake/openmake_llm/commit/f90b2a0d2e36ecf3afac1525b7a7c1fcf23400b9))
* **desktop-windows:** 아이콘 파일을 저장소에 포함 — *.png 무시 규칙의 예외로 둔다 ([b52d8ed](https://github.com/openmake/openmake_llm/commit/b52d8eddeca11565833bf86e1a4e378b1620c6ee))
* **desktop-windows:** 트레이에 OpenMake 로고를 쓴다 — 빈 아이콘이라 작업 표시줄에 보이지 않았다 ([7673e5e](https://github.com/openmake/openmake_llm/commit/7673e5e4ac77c69d3a679ab19aba9d03b394bce6))
* **desktop-windows:** 트레이에 OpenMake 로고를 쓴다 — 빈 아이콘이라 작업 표시줄에 보이지 않았다 ([bb145a6](https://github.com/openmake/openmake_llm/commit/bb145a6c87c84c23a683bfa712279f20463a6303))
* **env:** omk dev setup 에 --dgx-host 추가, 전역 오류 화면의 lint 오류 정리 ([971f119](https://github.com/openmake/openmake_llm/commit/971f1190346f0bf421b5eadcef9339bea8c1a336))
* **eval:** 에이전트 작업 과제 실행 전에 스키마 초기화를 기다린다 ([3715275](https://github.com/openmake/openmake_llm/commit/3715275f1e7d1bb87af3786322c9362f5fbbd5b5))
* **eval:** 에이전트 작업 과제 실행 전에 스키마 초기화를 기다린다 ([ca23763](https://github.com/openmake/openmake_llm/commit/ca2376356e448c53180e71615bcd29137aa2e64f))
* **eval:** 접기 회상·메모리 순위 평가가 저장소 .env 를 스스로 읽는다 ([cf5f541](https://github.com/openmake/openmake_llm/commit/cf5f5411d708015f586ab6e7f94ea607e7f4d749))
* **eval:** 평가 실행기가 서버와 다른 실행 소유권 이름을 쓴다 ([895ae51](https://github.com/openmake/openmake_llm/commit/895ae513d834b9ebd1a935d6f47d1bb8dcea8f74))
* hermes 검토에서 남은 항목 마무리 (메모리 쓰기·캐시 토큰·넘겨받기 브라우저 검사 외) ([4827d65](https://github.com/openmake/openmake_llm/commit/4827d65b6fed628aff2187b99d08cefe406b8241))
* http 중복 방지 키, refresh 잠금의 localStorage 폴백, 구 배정 경로의 슬롯 종류 검증 ([084daae](https://github.com/openmake/openmake_llm/commit/084daaecfc78e3f4dc3696a5d0a9fca86a32d276))
* **install:** 이 클론의 개발 서버가 잡은 포트는 옮기지 않는다 ([624b56c](https://github.com/openmake/openmake_llm/commit/624b56c9dbb527b804a748abb98a9d89649ba34a))
* **ios:** 채팅·비교 화면 모델 선택지에서 비채팅 모델 제외 ([189cc93](https://github.com/openmake/openmake_llm/commit/189cc933524fc9a505d785acedc384d8457412f8))
* **ios:** 채팅·비교 화면의 모델 선택지에서 비채팅 모델 제외 ([193be6c](https://github.com/openmake/openmake_llm/commit/193be6c65d339db00870c26aec971e1ce36a4c54))
* **llm:** 요청 priority 를 extra_body 에도 실어 게이트웨이 뒤 vLLM 까지 전달 ([1c1cff5](https://github.com/openmake/openmake_llm/commit/1c1cff555dd22a714ef1228be8a3bbe5b20284fd))
* **llm:** 요청 priority 를 extra_body 에도 실어 게이트웨이 뒤 vLLM 까지 전달 ([5b5f188](https://github.com/openmake/openmake_llm/commit/5b5f1885bb4e8c2e28db465dc9d080325188ea78))
* **local-bridge-core:** 재연결 백오프 테스트가 느린 CI 에서 흔들리지 않게 예약 횟수로 기다린다 ([c27af71](https://github.com/openmake/openmake_llm/commit/c27af7199ed1be3c25eb0d34c54c5c780fc8a5e5))
* **local-bridge:** 차단 목록 매칭 전에 제어 문자·줄 이음·$IFS·빈 따옴표를 정리 ([6f54f6a](https://github.com/openmake/openmake_llm/commit/6f54f6a33fb4c5c9109fce2d088348d3aa082ec4))
* **local-bridge:** 키 만료일 변경·계정 비활성화 때도 브리지 연결을 끊는다 ([690f5ae](https://github.com/openmake/openmake_llm/commit/690f5ae8403efca808bb74caa639ebb6d02fe2b2))
* **local-bridge:** 키 만료일 변경·계정 비활성화 때도 브리지 연결을 끊는다 ([b9fae0f](https://github.com/openmake/openmake_llm/commit/b9fae0f2ace7af45662d887ef599068bb87f6b8e))
* **local-browser:** 입력 결과에 실제 값을 돌려준다 — 확인하려고 같은 입력을 되풀이하지 않게 ([810d20d](https://github.com/openmake/openmake_llm/commit/810d20de0ba66f04d480a9d0f9e1c72d6c780a03))
* **local-browser:** 입력 결과에 실제 값을 돌려준다 — 확인하려고 같은 입력을 되풀이하지 않게 ([7cf08f0](https://github.com/openmake/openmake_llm/commit/7cf08f0d4c1b8fd37d6370bf946fb0f07a6afcc9))
* **mcp:** mcp_list_tools·mcp_call 이 전역 MCP 서버도 찾게 ([0eaf500](https://github.com/openmake/openmake_llm/commit/0eaf500a7db99f9eda026035874d1539faf12e26))
* **mcp:** 도구 결과의 이미지·오디오를 base64 로 싣지 않고 파일로 저장하거나 생략 안내로 바꾼다 ([9b09642](https://github.com/openmake/openmake_llm/commit/9b096424ca3d00886a8762f3542fab193c756c3e))
* **mcp:** 서버를 삭제하면 그 서버의 캐시 볼륨도 치운다 ([b7929f9](https://github.com/openmake/openmake_llm/commit/b7929f959ca80a154b36f80e4e36412a2b4f8608))
* **mcp:** 외부 도구 스키마의 $ref 를 인라인으로 풀어 끊긴 참조를 없앤다 ([3bc3f36](https://github.com/openmake/openmake_llm/commit/3bc3f36670f260cba3d02f7512994c403a328c1a))
* **mcp:** 전역 MCP 서버 자동 재연결 — 부팅 실패·예기치 않은 종료 뒤 백오프 재시도 ([fb8abda](https://github.com/openmake/openmake_llm/commit/fb8abda0aae6ccab87a85f405355b4d13d0b811b))
* **mcp:** 전역 MCP 서버 자동 재연결 — 부팅 실패·예기치 않은 종료 뒤 백오프 재시도 ([aa3a138](https://github.com/openmake/openmake_llm/commit/aa3a1382733ff6ba2d6a68494c8ed317f67623ac))
* **omk:** 'omk dev setup' 도 omk 래퍼를 깐다 ([d7f6d9d](https://github.com/openmake/openmake_llm/commit/d7f6d9d728eed5bd075853b6b48728c2743d79dc))
* **omk:** 'omk dev up' 도 래퍼가 없으면 깐다 ([3800739](https://github.com/openmake/openmake_llm/commit/3800739b5ad7da3789c92c24d5153dcef80972fe))
* **omk:** 'omk dev up' 도 래퍼가 없으면 깐다 ([1ad8c83](https://github.com/openmake/openmake_llm/commit/1ad8c8331e59b434d9aa36013f86f6a6846796dc))
* **omk:** brew node@24 에서 PM2 가 Next 웹을 못 띄우는 문제 ([52109dc](https://github.com/openmake/openmake_llm/commit/52109dc24f42a8bdf7fa9a211dff1d9a623b3cfc))
* **omk:** brew node@24 에서 PM2 가 Next 웹을 못 띄우는 문제 — '@' 없는 인터프리터를 준다 ([cf3828f](https://github.com/openmake/openmake_llm/commit/cf3828f5ec03a18f647f8bfd110985bc41e45eea))
* **omk:** dev setup 테스트가 실제 스택을 띄우지 않게 한다 ([332f0a3](https://github.com/openmake/openmake_llm/commit/332f0a31c04f6a10e235fa05dd7181261372bc2d))
* **omk:** egress 프록시 컨테이너 교체 판정을 소스 해시 라벨로 ([a82ae06](https://github.com/openmake/openmake_llm/commit/a82ae063c9a8004452cb1147987a3d2d87f664ec))
* **omk:** egress 프록시 컨테이너 교체 판정을 소스 해시 라벨로 ([33304b9](https://github.com/openmake/openmake_llm/commit/33304b9d0b233d21d99712e3c285ff7b792230b0))
* **omk:** shellcheck SC2034 — 테스트의 가짜 dev_locate 가 채우는 변수는 cmd_dev_setup 이 읽는다 ([0e5ffdb](https://github.com/openmake/openmake_llm/commit/0e5ffdb4e35b371ef2dc0acaea5cb5e70e94eae1))
* **omk:** 빌드 실패한 커밋에 통과 표지가 붙는 문제, 필수 체크 없이 자동 머지가 걸리는 문제 ([d6fbf5e](https://github.com/openmake/openmake_llm/commit/d6fbf5e401f30223c97f56f9493e3dbf25e7a435))
* **omk:** 빌드 실패한 커밋에 통과 표지가 붙는 문제, 필수 체크 없이 자동 머지가 걸리는 문제 ([fbae1a4](https://github.com/openmake/openmake_llm/commit/fbae1a4a4a17e91351ff0401c923e9c51da49018))
* **omk:** 작업 클론 안의 'omk dev' 는 그 클론의 omk.sh 로 실행한다 ([1293e67](https://github.com/openmake/openmake_llm/commit/1293e67d56c8e3792ce7f985f90b42d64d92a2fe))
* **omk:** 작업 클론 안의 'omk dev' 는 그 클론의 omk.sh 로 실행한다 ([cee84c5](https://github.com/openmake/openmake_llm/commit/cee84c596c0cb14ce015b0607554753a9d41442e))
* **org-policy:** 조직 BROWSER_SITE_POLICY 저장 시 전역 설정과 같은 패턴 검증 ([993085a](https://github.com/openmake/openmake_llm/commit/993085a829ed04cc92b4441718ad950001976ed1))
* **org-policy:** 조직 BROWSER_SITE_POLICY 저장 시 전역 설정과 같은 패턴 검증을 한다 ([467a8a4](https://github.com/openmake/openmake_llm/commit/467a8a4d8c72e2e5905c9e503efdf88e6d34513f))
* **providers:** API 키 거절 안내와 키 검증을 실제 호출로 ([ac315cd](https://github.com/openmake/openmake_llm/commit/ac315cda07b3d5ead3cad0a4300af8840f96f630))
* **providers:** API 키 거절을 그대로 알리고, 키 검증을 실제 호출로 확인 ([f2e1bb5](https://github.com/openmake/openmake_llm/commit/f2e1bb5212e937ca5352e912c8476f63d08a2983))
* stuck 안내의 자리, 평가 실행기의 실행 소유권 이름 ([9049092](https://github.com/openmake/openmake_llm/commit/9049092368ed6175fe78899c8be707597487b57b))
* **task-runtime:** 샌드박스 브라우저의 입력 결과에 실제 값을 돌려준다 ([5be50ec](https://github.com/openmake/openmake_llm/commit/5be50ec9e61dc92677901c7366522733194e22ae))
* **task-runtime:** 샌드박스 브라우저의 입력 결과에 실제 값을 돌려준다 ([cb74e44](https://github.com/openmake/openmake_llm/commit/cb74e449cc2e42872129f404840ba8ad4391c483))
* **task-sandbox:** 봇 차단 감지 패턴을 실제 페이지 실측에 맞춰 조인다 ([393974f](https://github.com/openmake/openmake_llm/commit/393974fc29e7eb5593374cd8ee137d412bd38700))
* **task-sandbox:** 봇 차단 경고가 캡차 설명 글·오류 안내 문서·로그인 폼에 붙던 오탐을 줄인다 ([923d523](https://github.com/openmake/openmake_llm/commit/923d523784952be7015d82ccbd2d258d90990794))
* **task-sandbox:** 브라우저 실행 중에 사용자가 넘겨받았으면 결과를 버린다 ([9a836be](https://github.com/openmake/openmake_llm/commit/9a836be8e1ff693280949e8952f306d3a156c606))
* **task-sandbox:** 일회성 브라우저 컨테이너에 이름을 붙이고 시간 초과 때 컨테이너까지 정리한다 ([74c0bfc](https://github.com/openmake/openmake_llm/commit/74c0bfcba00480e327f078183d9ef9d6b7761603))
* **task-sandbox:** 타임아웃·취소 뒤 컨테이너 안 프로세스가 계속 돌던 문제 ([b988163](https://github.com/openmake/openmake_llm/commit/b988163f1c455364086a27c60829591ab991f619))
* **web:** escape literal ${KEY} in marketplace secretNote ([aa1f275](https://github.com/openmake/openmake_llm/commit/aa1f27512ad6cb28f04642ebf11a9b6413ea301a))
* **web:** http 접속에서 파일 첨부가 죽고 세션 이관이 400 나던 문제 ([a24a88e](https://github.com/openmake/openmake_llm/commit/a24a88e438d498445dae59dfa7324214273f9e06))
* **web:** http 접속의 첨부 오류·세션 이관 400, 개발 모드 소켓 경고 ([f592a63](https://github.com/openmake/openmake_llm/commit/f592a63241764bf82f3fce6a1a16dc3f89c4a906))
* **web:** pin react version in eslint settings for eslint 10 ([5393036](https://github.com/openmake/openmake_llm/commit/5393036dede70f8ed4cec49a2b3ba739a65e2e7e))
* **web:** re-handshake chat socket after session restore, single-flight refresh ([ecf1528](https://github.com/openmake/openmake_llm/commit/ecf1528625a335fe47a2bbe3e80830c7f9519b16))
* **web:** retry auth sync on server errors, serialize token refresh across tabs ([25b33de](https://github.com/openmake/openmake_llm/commit/25b33dee153e04fd6a1a495222f8e28cdc93c46f))
* **web:** 게이트웨이 모델 카드의 중복 key 경고 ([940b092](https://github.com/openmake/openmake_llm/commit/940b092c763740ba97febf5d16af7a4cf00f65bf))
* **web:** 게이트웨이 모델 카드의 중복 key 경고 ([8fcc51a](https://github.com/openmake/openmake_llm/commit/8fcc51adf2e258459d9bc3780f4ee13ffe46afb7))
* **web:** 답변 중 다른 대화로 전환하면 이전 답변이 새 화면에 이어 그려지던 문제 ([f2e412d](https://github.com/openmake/openmake_llm/commit/f2e412d670e25afb1c16c0913b2926342fc117eb))
* **web:** 마켓플레이스 게시 안내문의 ${KEY} 포맷 오류 ([657c1b8](https://github.com/openmake/openmake_llm/commit/657c1b8bf18c837f96b7765d2ed52af72ee9dd42))
* **web:** 세션 복원·재기동·여러 탭에서 로그인 상태가 어긋나는 문제 네 가지 ([51709da](https://github.com/openmake/openmake_llm/commit/51709da74354d024a29686d46c70c2b5ac2dec9e))
* **web:** 연결 중인 채팅 소켓을 effect 정리에서 닫지 않는다 ([9014917](https://github.com/openmake/openmake_llm/commit/90149173776cf64d75bfd6d27e98f7d100be6242))
* **web:** 자동 승인 뒤에도 계속 물어야 하는 승인 카드는 화면에 남긴다 ([84b4c61](https://github.com/openmake/openmake_llm/commit/84b4c61e567a5641873f8d22fd0a1a8de144761c))
* **web:** 작업 목표 줄 넘침과 절차 본문 미리보기 표시 ([f661d2f](https://github.com/openmake/openmake_llm/commit/f661d2fbbac7a2cfcb9214519744a7cb043bd577))
* **web:** 작업 목표 줄 넘침과 절차 본문 미리보기 표시 ([c23aeb2](https://github.com/openmake/openmake_llm/commit/c23aeb2f1b7c7c0ab9e855457136af83de6a49ad))
* **web:** 작업 방향 지시 입력란도 Enter 로 전송 ([f06e3d2](https://github.com/openmake/openmake_llm/commit/f06e3d2b94a4d7565a1af50d0fbecb823ec6966b))
* **web:** 작업 방향 지시 입력란도 Enter 로 전송 ([475b511](https://github.com/openmake/openmake_llm/commit/475b511f8f8e5e2e90002a62bba66495fa1a214d))
* **web:** 작은따옴표로 감싼 번역 변수·이중 중괄호 문구 수정, i18n 형식 가드 ([98766ee](https://github.com/openmake/openmake_llm/commit/98766ee4e992ac01753a890b51799d176d2388c8))
* **web:** 질문 카드 Enter 전송, 승인함 거절 문구 통일, 작업 상세 상태 번역 ([0d823b2](https://github.com/openmake/openmake_llm/commit/0d823b2c5f508925896f37efa4b30ed80602fc09))
* 남은 항목 정리 — 번역·http 접속·대화 전환 누수·플래너 폴백·jev 게이트 등 ([5ea6b86](https://github.com/openmake/openmake_llm/commit/5ea6b8631bc39232ece0e1e795f9b2f314c5b6c6))
* 미처리 항목 정리 — Lyria 음악 배정, 슬롯 종류 검증, 400 폴백, 기본 MCP 시드, omk dev setup --dgx-host ([fd2bf98](https://github.com/openmake/openmake_llm/commit/fd2bf9806ad11208864b6326c4254d6cbb7fb5a0))
* 실패 사유 번역 보강과 CLI 확인 창 전체 보기 ([44b1c90](https://github.com/openmake/openmake_llm/commit/44b1c90b87b9109f40a61b2473479d65636d7e72))
* 실패 사유 번역 보강과 CLI 확인 창 전체 보기 ([2866ebd](https://github.com/openmake/openmake_llm/commit/2866ebd0a9221560524bd95041fa817486de8a17))
* 예약 자동 비활성 사유 표시, 봇 차단 경고 오탐 줄이기 ([aa8f51a](https://github.com/openmake/openmake_llm/commit/aa8f51a494ce2e8fad058c08734f9875d6d5cf96))
* 예전 형식 익명 id 이관, 플래너 전송 오류 시 로컬 폴백, 정리 3건 ([9021fa2](https://github.com/openmake/openmake_llm/commit/9021fa24c9d2685d8362798c79da363f7fd5321e))
* 충돌 해소 커밋에 잘못 들어간 node_modules 심볼릭 링크 제거 ([b94d7ff](https://github.com/openmake/openmake_llm/commit/b94d7ffc518333fcce27f6869d50fda682a0aa69))


### ⚡ 성능

* **test:** apps/api jest 에서 ts-jest 타입 검사 제거 (isolatedModules) ([994a7d4](https://github.com/openmake/openmake_llm/commit/994a7d49834839430c65f7f6df461f903f21f437))
* **test:** apps/api jest 에서 ts-jest 타입 검사 제거 (isolatedModules) ([e05fa4c](https://github.com/openmake/openmake_llm/commit/e05fa4cca9b8abc0d4e9665782b381165e097d05))


### ♻️ 리팩터링

* **agent-task:** AgentTaskService 분리(600→580줄)와 테스트 타입 오류 수정 ([e781641](https://github.com/openmake/openmake_llm/commit/e781641dc237b3d81da95b7e563e0b7781ebbdbf))
* **agent-task:** AgentTaskService 에서 첨부 주입·부분 결과 조립을 분리하고 테스트 타입 오류를 고친다 ([917bf34](https://github.com/openmake/openmake_llm/commit/917bf3459095e59cf756bd2e829627d54bf98a33))
* **agent-task:** fork 작업 공간 복원 호출을 기준점 생성 함수 안으로 ([bb797f2](https://github.com/openmake/openmake_llm/commit/bb797f223757e31bb988f80fa0b86f63ccb71022))
* **agent-task:** 작업 파일 전송을 helpers 로 분리(600줄 CI 가드) ([4576948](https://github.com/openmake/openmake_llm/commit/4576948990f7d6c87904b93ff76afc78f29bb51c))
* **agent-task:** 절차 스킬 도구 정의를 tools-procedural.ts 로 분리 ([fa2d180](https://github.com/openmake/openmake_llm/commit/fa2d18068f092d7144cca31205dd02f3b347cca3))
* **agent-task:** 주차 조회 쿼리를 별도 저장소 파일로 분리 — 파일 크기 가드(600줄) ([f8ec51c](https://github.com/openmake/openmake_llm/commit/f8ec51c0196625c822729735558529ad615267df))
* **agent-task:** 턴 진행률 계산을 turn-progress 모듈로 분리 ([4599eb0](https://github.com/openmake/openmake_llm/commit/4599eb048c719ed4c03c3958a24db71745dbfe4b))
* **skill:** 범주 제외 조건을 줄여 쓴다 (lint 줄 수) ([9a6f68a](https://github.com/openmake/openmake_llm/commit/9a6f68a04a100e1161198f19723dcf8807a8a605))

## [1.91.0](https://github.com/openmake/openmake_llm/compare/v1.90.1...v1.91.0) (2026-09-30)


### ✨ 기능

* **install:** macOS 는 Docker Desktop 대신 전용 Colima 를 쓴다 ([4f88d90](https://github.com/openmake/openmake_llm/commit/4f88d902a07edac8a690a65bd119ae9934708940))
* **omk:** 릴리스 게이트 — staging 에서 확인한 커밋만 online 에 올린다 ([810400e](https://github.com/openmake/openmake_llm/commit/810400eba8481e8a4096c58f74f78d6aa5571340))
* **omk:** 설치·갱신·리셋의 출력을 파일로도 남긴다 ([d7dd81b](https://github.com/openmake/openmake_llm/commit/d7dd81bfff92359febc50bcce0a8a8d7a8cd43b3))
* **omk:** 환경 dev 는 브랜치 dev 를 따른다 ([e701389](https://github.com/openmake/openmake_llm/commit/e701389327b15563aa616bd4a6e790ee57cebb62))


### 🐛 버그 수정

* **deps:** brace-expansion 을 올린다 — high 권고 2건 ([e9be66f](https://github.com/openmake/openmake_llm/commit/e9be66f4058283fad6640108022b40432db07f0a))
* **deps:** brace-expansion 을 올린다 — high 권고 2건 ([c26a01b](https://github.com/openmake/openmake_llm/commit/c26a01bde87bcbef269b5dadd5b177fdc03102d6))
* **deps:** fast-uri 를 3.1.8 로 올린다 — high 권고 2건 ([d292007](https://github.com/openmake/openmake_llm/commit/d292007b50dd0a768a83ca0b5751e5ed6b1d210b))
* **install:** macOS — 이미 동작하는 Docker(Colima 등)가 있으면 Docker Desktop 을 깔지 않는다 ([#1032](https://github.com/openmake/openmake_llm/issues/1032)) ([a464450](https://github.com/openmake/openmake_llm/commit/a46445059c28b516db3aaefa70227995c3e7d9af))
* **mcp:** 샌드박스가 docker 접속처를 넘기고, 서버 설정의 DOCKER_* 는 버린다 ([3efbb37](https://github.com/openmake/openmake_llm/commit/3efbb373871093b4a4d60a3d6db4abc6abf60ca4))
* **omk:** shellcheck SC2120 — 인자는 테스트가 준다 ([cd58f2a](https://github.com/openmake/openmake_llm/commit/cd58f2a344b92ea8b7c0a53e145a5dad78263697))
* **omk:** 개발 서버도 환경과 같은 단계로 준비한다 ([d7e8300](https://github.com/openmake/openmake_llm/commit/d7e83009e3c004be1601400584daae86a5197331))
* **omk:** 브랜치 dev 가 없는 저장소에서 무엇을 하면 되는지 알려준다 ([fe77c32](https://github.com/openmake/openmake_llm/commit/fe77c32d92f85cf9b2c7b9296409ce0b71ee8986))
* **omk:** 테스트의 stat 을 GNU 형식부터 본다 — Linux 에서 실패했다 ([ccc710f](https://github.com/openmake/openmake_llm/commit/ccc710f45a2d79946912493f974303c49f108e76))
* **task-sandbox:** Colima 에서 호스트가 쓴 파일을 컨테이너가 잘라 읽던 문제 ([80fa876](https://github.com/openmake/openmake_llm/commit/80fa876939fc8acc1885780a12364504e6c6aad3))

## [1.90.1](https://github.com/openmake/openmake_llm/compare/v1.90.0...v1.90.1) (2026-09-27)


### 🐛 버그 수정

* **deps:** 보안 권고 해소 — kordoc·sharp·qs 상향 + 범위 내 패치 갱신 ([#1034](https://github.com/openmake/openmake_llm/issues/1034)) ([9514d1b](https://github.com/openmake/openmake_llm/commit/9514d1b2f0251310f0ce5d2152dbf587e0efbc33))

## [1.90.0](https://github.com/openmake/openmake_llm/compare/v1.89.0...v1.90.0) (2026-09-25)


### ✨ 기능

* **install:** OS 별 원샷 설치 — install_mac.sh·install_linux.sh + omk 운영 구성 옵션 ([#1028](https://github.com/openmake/openmake_llm/issues/1028)) ([7651b20](https://github.com/openmake/openmake_llm/commit/7651b20539f6d47a2accb3c6b540eafccfe21b25))


### 🐛 버그 수정

* **orchestrator:** 붙여 넣은·직전 답변 가사로 음악 생성 — Planner 는 CONVERSATION 표시만, 외부 직결 요청 규칙, 계획 실패 안내 ([#1029](https://github.com/openmake/openmake_llm/issues/1029)) ([d219a43](https://github.com/openmake/openmake_llm/commit/d219a434a281c8eca5ff9d136ef5b0d08c829cc8))

## [1.89.0](https://github.com/openmake/openmake_llm/compare/v1.88.5...v1.89.0) (2026-09-25)


### ✨ 기능

* **knowledge:** 스페이스 지침·메모리 + 활성 index 모델 고정 임베딩 ([#1026](https://github.com/openmake/openmake_llm/issues/1026)) ([230cba8](https://github.com/openmake/openmake_llm/commit/230cba802a724ac4b50da3a2c8b66e4709f3d3e0))
* **orchestrator:** audio·music·video 분석 capability 실행기 편입 ([#1023](https://github.com/openmake/openmake_llm/issues/1023)) ([14885ed](https://github.com/openmake/openmake_llm/commit/14885ed44aaaa4e7416afefd3f30608f0fa1b650))


### 🐛 버그 수정

* **build:** typescript 별칭을 실제 typescript@6 패키지로 — IDE 가 기본 lib 를 못 찾던 문제 ([#1025](https://github.com/openmake/openmake_llm/issues/1025)) ([f892b0d](https://github.com/openmake/openmake_llm/commit/f892b0df4579ea16ae35f3caf76c286a3d48d757))
* **models:** 외부 provider /v1/models 라이브 조회에 시간 상한 — 무응답 시 이전 캐시·fallback ([#1022](https://github.com/openmake/openmake_llm/issues/1022)) ([89fabe7](https://github.com/openmake/openmake_llm/commit/89fabe7c4198533a96807603db96f44fcacf94a0))

## [1.88.5](https://github.com/openmake/openmake_llm/compare/v1.88.4...v1.88.5) (2026-09-25)


### 🐛 버그 수정

* **orchestrator:** text.reason 로컬 모델 추론 끄기 + 구 모델 배정 3테이블 DROP(171) ([#1020](https://github.com/openmake/openmake_llm/issues/1020)) ([f03d2c7](https://github.com/openmake/openmake_llm/commit/f03d2c75f7766e37cf762b267039a93d57e690a4))

## [1.88.4](https://github.com/openmake/openmake_llm/compare/v1.88.3...v1.88.4) (2026-09-25)


### 🐛 버그 수정

* **llm:** choices 없는 비스트림 응답을 재시도 가능한 502 로 처리 ([#1016](https://github.com/openmake/openmake_llm/issues/1016)) ([b186c03](https://github.com/openmake/openmake_llm/commit/b186c03b6f791158907227ae8b0de86fece96fb6))

## [1.88.3](https://github.com/openmake/openmake_llm/compare/v1.88.2...v1.88.3) (2026-09-24)


### 🐛 버그 수정

* **settings:** 요청 한도 소진 시 설정이 기본값으로 보이고 저장하면 덮어써지던 문제 ([#1013](https://github.com/openmake/openmake_llm/issues/1013)) ([f599429](https://github.com/openmake/openmake_llm/commit/f599429924f9bdb00829fc6d561e8eacc8ed4e3f))

## [1.88.2](https://github.com/openmake/openmake_llm/compare/v1.88.1...v1.88.2) (2026-09-24)


### 🐛 버그 수정

* **music:** 음표 길이를 곡 길이로 읽던 문제와 가사 작업 결과가 음악에 전달되지 않던 문제 ([#1011](https://github.com/openmake/openmake_llm/issues/1011)) ([db71bb3](https://github.com/openmake/openmake_llm/commit/db71bb38adf72e83cd2a3f9c8ba38fcf65e39fd7))

## [1.88.1](https://github.com/openmake/openmake_llm/compare/v1.88.0...v1.88.1) (2026-09-24)


### 🐛 버그 수정

* **orchestrator:** 긴 multi 계획이 Planner 출력 상한에서 잘려 음악 등 미디어가 실행되지 않던 문제 ([#1009](https://github.com/openmake/openmake_llm/issues/1009)) ([8ed5e4b](https://github.com/openmake/openmake_llm/commit/8ed5e4b41a067d16ba2fe0c9f38b5718208aa165))

## [1.88.0](https://github.com/openmake/openmake_llm/compare/v1.87.0...v1.88.0) (2026-09-24)


### ✨ 기능

* **env:** 환경 모델 정리 — main 하나·online 은 릴리스 태그, 환경별 LiteLLM·기본 모델·런타임 이미지 ([#965](https://github.com/openmake/openmake_llm/issues/965)) ([ce0f222](https://github.com/openmake/openmake_llm/commit/ce0f222e2ba27e38d656bec948866c9f5a262fc0))


### 🐛 버그 수정

* **infra:** DB 기본 이미지를 pgvector PG16 으로 — Knowledge add-on 의 vector 확장 전제 ([#1007](https://github.com/openmake/openmake_llm/issues/1007)) ([f7ceb41](https://github.com/openmake/openmake_llm/commit/f7ceb41d38513105c72805d9dabb28d2b399d134))

## [1.87.0](https://github.com/openmake/openmake_llm/compare/v1.86.3...v1.87.0) (2026-09-24)


### ✨ 기능

* **chat:** 답변하는 모델을 실시간으로 표시 ([#1005](https://github.com/openmake/openmake_llm/issues/1005)) ([5beb89d](https://github.com/openmake/openmake_llm/commit/5beb89d616fbe45fde4db8a66b347c84ed0194ad))

## [1.86.3](https://github.com/openmake/openmake_llm/compare/v1.86.2...v1.86.3) (2026-09-24)


### ♻️ 리팩터링

* **models:** 역할별·기능별 모델 배정을 슬롯 단위 모델 배정으로 통합 + Planner 잘린 simple 계획 복구 ([#1003](https://github.com/openmake/openmake_llm/issues/1003)) ([496078a](https://github.com/openmake/openmake_llm/commit/496078a90ec63e3cb8f2938704fd19d47eb0588a))

## [1.86.2](https://github.com/openmake/openmake_llm/compare/v1.86.1...v1.86.2) (2026-09-24)


### 🐛 버그 수정

* **knowledge:** 코드 리뷰 결함 4건 — 프로필 저장 400·재시도 횟수·출처 번호 충돌·재색인 전환 경합 ([#1001](https://github.com/openmake/openmake_llm/issues/1001)) ([fc7831c](https://github.com/openmake/openmake_llm/commit/fc7831c3c0bdb33e4b561792cf22bfff3bf98c84))
* **web:** 페이지 본문 폭 통일(max-w-6xl) + 설정 화면 컨트롤·글자 크기 스케일 통일 ([#1000](https://github.com/openmake/openmake_llm/issues/1000)) ([2391ac6](https://github.com/openmake/openmake_llm/commit/2391ac67710bed51fca38d8abf507723f80390fb))

## [1.86.1](https://github.com/openmake/openmake_llm/compare/v1.86.0...v1.86.1) (2026-09-24)


### 🐛 버그 수정

* **knowledge:** 라우트 응답을 공유 계약에 맞춤 — Space 상세가 "찾을 수 없음"으로 뜨던 결함 + 라이브 검증 UI 보완 ([#998](https://github.com/openmake/openmake_llm/issues/998)) ([4d929cb](https://github.com/openmake/openmake_llm/commit/4d929cb7e147b51dea32c99f7f99c5dcbd2cea59))

## [1.86.0](https://github.com/openmake/openmake_llm/compare/v1.85.4...v1.86.0) (2026-09-23)


### ✨ 기능

* **knowledge:** Knowledge Space — 문서 기반 작업공간(pgvector RAG) + Base 일반 확장점 ([#996](https://github.com/openmake/openmake_llm/issues/996)) ([7895faa](https://github.com/openmake/openmake_llm/commit/7895faa6c24a35296fd7c7c7b70f0fbe4b3aea41))

## [1.85.4](https://github.com/openmake/openmake_llm/compare/v1.85.3...v1.85.4) (2026-09-23)


### ♻️ 리팩터링

* 하드코딩 전수 제거 — 프롬프트·LLM 파라미터·임계값·타이머를 config/prompts 로 외부화 ([#994](https://github.com/openmake/openmake_llm/issues/994)) ([714a32e](https://github.com/openmake/openmake_llm/commit/714a32efcac59b7882c4b2195407bfe5ed30f655))

## [1.85.3](https://github.com/openmake/openmake_llm/compare/v1.85.2...v1.85.3) (2026-09-23)


### 🐛 버그 수정

* **job-runtime:** poller lease heartbeat·병렬 진행·수집 소진 재선점 루프·폴링 실패의 수집 예산 소진 ([#992](https://github.com/openmake/openmake_llm/issues/992)) ([acc13c0](https://github.com/openmake/openmake_llm/commit/acc13c097c4ea049ad0f04504a8c1c1b61c4bf9f))

## [1.85.2](https://github.com/openmake/openmake_llm/compare/v1.85.1...v1.85.2) (2026-09-23)


### 🐛 버그 수정

* **security:** safeFetch undici 8 비호환으로 외부 연결 전면 실패 — undici fetch 로 통일 ([#990](https://github.com/openmake/openmake_llm/issues/990)) ([94dee5a](https://github.com/openmake/openmake_llm/commit/94dee5acfa098d1c44a8b5ccae9b837cb0664b30))

## [1.85.1](https://github.com/openmake/openmake_llm/compare/v1.85.0...v1.85.1) (2026-09-23)


### 🐛 버그 수정

* **addon:** 관리자 add-on 토글 SQL 파라미터 타입 추론 실패 — setState 명시 캐스트 ([#986](https://github.com/openmake/openmake_llm/issues/986)) ([673b9a4](https://github.com/openmake/openmake_llm/commit/673b9a4a7cc07cbbb9ffe9edfd3e26c1335792ae))

## [1.85.0](https://github.com/openmake/openmake_llm/compare/v1.84.0...v1.85.0) (2026-09-23)


### ✨ 기능

* **capability:** Base·Add-on 통합 P01–P10 — Capability Registry·실행 승인·Artifact 소유권·Job Runtime·미디어 runtime add-on ([#984](https://github.com/openmake/openmake_llm/issues/984)) ([aba3b4a](https://github.com/openmake/openmake_llm/commit/aba3b4a1305e5c1ba14116e896b1660986b4da4c))

## [1.84.0](https://github.com/openmake/openmake_llm/compare/v1.83.0...v1.84.0) (2026-09-23)


### ✨ 기능

* **chat:** 생성 미디어 다운로드 + 음악·영상 길이 원문 보정 ([#982](https://github.com/openmake/openmake_llm/issues/982)) ([e91d6bf](https://github.com/openmake/openmake_llm/commit/e91d6bf3e6165437b1ffdc6539f64660eec098ee))

## [1.83.0](https://github.com/openmake/openmake_llm/compare/v1.82.0...v1.83.0) (2026-09-22)


### ✨ 기능

* **models:** 기능별 모델 배정에 로컬 비채팅 모델(임베딩·음악) 노출 ([#979](https://github.com/openmake/openmake_llm/issues/979)) ([01befcc](https://github.com/openmake/openmake_llm/commit/01befcc8d150ce6e20d8f73e84ec9c22fb2437fe))
* **music:** ACE-Step XL turbo 로 교체 + canary-deploy 카나리 종료 보강 ([#981](https://github.com/openmake/openmake_llm/issues/981)) ([e818bcf](https://github.com/openmake/openmake_llm/commit/e818bcf9d55be654a308b41f9c0770eba50beca5))

## [1.82.0](https://github.com/openmake/openmake_llm/compare/v1.81.0...v1.82.0) (2026-09-22)


### ✨ 기능

* **orchestrator:** 음악 생성(music.generate) — DGX ACE-Step 1.5 를 LiteLLM 게이트웨이로 ([#977](https://github.com/openmake/openmake_llm/issues/977)) ([4710ffc](https://github.com/openmake/openmake_llm/commit/4710ffcca1bbe741c1023ada060646a41b2679b7))

## [1.81.0](https://github.com/openmake/openmake_llm/compare/v1.80.1...v1.81.0) (2026-09-22)


### ✨ 기능

* **providers:** Logfare 외부 provider 추가 — BYOK + LiteLLM 게이트웨이 wildcard ([#975](https://github.com/openmake/openmake_llm/issues/975)) ([503d8f8](https://github.com/openmake/openmake_llm/commit/503d8f8fb45a1a6104685f09fcb488051edaff53))

## [1.80.1](https://github.com/openmake/openmake_llm/compare/v1.80.0...v1.80.1) (2026-09-22)


### 🐛 버그 수정

* **orchestrator:** 영상 길이·비율 전달과 깨진 자막 억제 ([#973](https://github.com/openmake/openmake_llm/issues/973)) ([b25b7fd](https://github.com/openmake/openmake_llm/commit/b25b7fdbd6eca165c485b32ae6a39354217880f3))

## [1.80.0](https://github.com/openmake/openmake_llm/compare/v1.79.0...v1.80.0) (2026-09-20)


### ✨ 기능

* **addon:** 팩 eval — 라우팅 케이스 팩 소유·팩 검증 러너·검증된 모델 표시 (S3 잔여) ([#960](https://github.com/openmake/openmake_llm/issues/960)) ([38112be](https://github.com/openmake/openmake_llm/commit/38112beaddb6a2c84988ffa1d5e0a6bdd218abfd))
* **eval:** 모델 도입 절차 — 실측 프로브·전환 게이트·프로필 capability 배선 (S2 잔여) ([#959](https://github.com/openmake/openmake_llm/issues/959)) ([a1467df](https://github.com/openmake/openmake_llm/commit/a1467dffbf677f6992ee7774b312ce2c92afd78a))
* **extension:** 확장의 조직 공개 — 매니페스트 scope=organization 반영 (166) ([#961](https://github.com/openmake/openmake_llm/issues/961)) ([c7c5d5a](https://github.com/openmake/openmake_llm/commit/c7c5d5ab8de31abf4ee12c44af1c55283bf9bd7d))


### 🐛 버그 수정

* **ci:** 릴리스 SBOM 생성이 overrides 때문에 실패하던 문제 — cyclonedx --ignore-npm-errors ([#963](https://github.com/openmake/openmake_llm/issues/963)) ([a23fdfc](https://github.com/openmake/openmake_llm/commit/a23fdfcfabd37f4c8f135877ebcfa44c3c0c4fd3))


### ♻️ 리팩터링

* **search:** 검색 provider 레지스트리 — 네이버·다음·Exa·Tavily 를 search-providers add-on 으로 ([#962](https://github.com/openmake/openmake_llm/issues/962)) ([451e78b](https://github.com/openmake/openmake_llm/commit/451e78b21f4776d3d316a1a849a218c95a3cf1b6))

## [1.79.0](https://github.com/openmake/openmake_llm/compare/v1.78.0...v1.79.0) (2026-09-20)


### ✨ 기능

* **env:** dev·staging·online 환경 매니저 omk + 설치 직후 웹 검색(SearXNG) ([#946](https://github.com/openmake/openmake_llm/issues/946)) ([74ea322](https://github.com/openmake/openmake_llm/commit/74ea322cd07e884bb841fbe3f41e76c41676c691))

## [1.78.0](https://github.com/openmake/openmake_llm/compare/v1.77.1...v1.78.0) (2026-09-20)


### ✨ 기능

* **addon:** 매니페스트 permissions 를 실제로 집행한다 — 선언만 있던 권한 ([#954](https://github.com/openmake/openmake_llm/issues/954)) ([098a5ee](https://github.com/openmake/openmake_llm/commit/098a5ee98b36cf608571b448c4565d8a94faf5d3))


### 🐛 버그 수정

* **extension:** 업데이트가 승인을 이어받고, 제거가 상태 표에 반영된다 + 무료 방침 표현 정리 ([#956](https://github.com/openmake/openmake_llm/issues/956)) ([48447d0](https://github.com/openmake/openmake_llm/commit/48447d068e0b94ae13c0f91443704573f3dba9f1))
* **skill:** archived 스킬의 도구 바인딩이 계속 따라오던 문제 + 회수 시 배정 정리 ([#957](https://github.com/openmake/openmake_llm/issues/957)) ([7b6509b](https://github.com/openmake/openmake_llm/commit/7b6509ba41219323576f510666dd68c6020e862e))

## [1.77.1](https://github.com/openmake/openmake_llm/compare/v1.77.0...v1.77.1) (2026-09-19)


### 🐛 버그 수정

* **addon:** 라우트 게이트가 인증 문맥 없이 돌아 조직 사용권(403)이 적용되지 않던 결함 ([#953](https://github.com/openmake/openmake_llm/issues/953)) ([7ca465c](https://github.com/openmake/openmake_llm/commit/7ca465c008eb94df0ea107547947b3e78b3f0e28))
* **deps:** adm-zip 0.6.1 로 고정 — 새 high 권고로 main CI 가 막히던 문제 ([#947](https://github.com/openmake/openmake_llm/issues/947)) ([ebddd13](https://github.com/openmake/openmake_llm/commit/ebddd13f6fb5e3d0676237d0c5d1860a93d12f25))

## [1.77.0](https://github.com/openmake/openmake_llm/compare/v1.76.0...v1.77.0) (2026-09-19)


### ✨ 기능

* **addon:** MCP·Skill 런타임을 add-on 으로 분리 + 선언형 Add-on 완성(상태·사용권·스키마·모델 요구) ([#950](https://github.com/openmake/openmake_llm/issues/950)) ([6ca9859](https://github.com/openmake/openmake_llm/commit/6ca9859931afe82f281c8d29358202621f44ef2f))
* **llm:** 모델 프로필 — 모델마다 다른 값을 선언 테이블 하나로 ([#944](https://github.com/openmake/openmake_llm/issues/944)) ([5921e29](https://github.com/openmake/openmake_llm/commit/5921e29134ab3948f2630d098b02da0fd8106530))

## [1.76.0](https://github.com/openmake/openmake_llm/compare/v1.75.0...v1.76.0) (2026-09-18)


### ✨ 기능

* **addon:** 토론·딥리서치를 add-on 으로 분리 — 채팅 모드 확장점 ([#942](https://github.com/openmake/openmake_llm/issues/942)) ([ba62046](https://github.com/openmake/openmake_llm/commit/ba6204660b4a4a88c85d6bef221ac6c165eb1a9c))

## [1.75.0](https://github.com/openmake/openmake_llm/compare/v1.74.0...v1.75.0) (2026-09-18)


### ✨ 기능

* **addon:** Base(API·웹)에서 add-on 고유 이름 제거 — 산업 팩 본문 교체·통합 확장점·커넥터 팩 ([#941](https://github.com/openmake/openmake_llm/issues/941)) ([1a5d891](https://github.com/openmake/openmake_llm/commit/1a5d891f4e246ca605d28f78b65991e9fb67dbc6))


### ♻️ 리팩터링

* **addon:** 팩별 시더를 매니페스트 기반 범용 설치기로 교체 + 팩 콘텐츠를 dist 스냅샷으로 ([#939](https://github.com/openmake/openmake_llm/issues/939)) ([850557b](https://github.com/openmake/openmake_llm/commit/850557b3dc1f7a4bca516b5f9298626fb2657d05))

## [1.74.0](https://github.com/openmake/openmake_llm/compare/v1.73.1...v1.74.0) (2026-09-18)


### ✨ 기능

* **addon:** Base↔Add-on 경계 고정 + Add-on Host·내장 팩 분리 ([#937](https://github.com/openmake/openmake_llm/issues/937)) ([c8e719c](https://github.com/openmake/openmake_llm/commit/c8e719c8aace89d68e986e2fa25e68af10d4f3b6))

## [1.73.1](https://github.com/openmake/openmake_llm/compare/v1.73.0...v1.73.1) (2026-09-18)


### ♻️ 리팩터링

* **cleanup:** 폐기 계층 데드코드 정리 + 정산 잡 종료 배선 누락 수정 ([#934](https://github.com/openmake/openmake_llm/issues/934)) ([bc9dd19](https://github.com/openmake/openmake_llm/commit/bc9dd190a5f993125ed6dad0256965125c519594))

## [1.73.0](https://github.com/openmake/openmake_llm/compare/v1.72.0...v1.73.0) (2026-09-17)


### ✨ 기능

* **discord:** 봇 설정을 관리자 화면에서 관리하고 기동 시 서버에서 받아가게 ([#932](https://github.com/openmake/openmake_llm/issues/932)) ([5216439](https://github.com/openmake/openmake_llm/commit/5216439de3600688ecf70c6eb951625800a5cf49))

## [1.72.0](https://github.com/openmake/openmake_llm/compare/v1.71.0...v1.72.0) (2026-09-17)


### ✨ 기능

* **web:** 커넥터 설치·자격증명 화면에서 선택 항목도 입력 가능하게 ([#930](https://github.com/openmake/openmake_llm/issues/930)) ([fd4d721](https://github.com/openmake/openmake_llm/commit/fd4d721914da86a6b1fd0abd92ed4377f956c91c))

## [1.71.0](https://github.com/openmake/openmake_llm/compare/v1.70.1...v1.71.0) (2026-09-17)


### ✨ 기능

* 기능 갭 3종 — 커넥터 카탈로그 시드·배포 운영 자동화·평가 비용 게이트와 비토큰 회계 (마이그레이션 159~162) ([#928](https://github.com/openmake/openmake_llm/issues/928)) ([b337ae4](https://github.com/openmake/openmake_llm/commit/b337ae4cfac71e1468ae93f2182aad1d52eee1b5))

## [1.70.1](https://github.com/openmake/openmake_llm/compare/v1.70.0...v1.70.1) (2026-09-17)


### 🐛 버그 수정

* 라이브 검증 결함 3건 — 웹 인용 칩 라벨 마커·체크포인트 분기 턴 -1/0·분기 안내 역할 ([#925](https://github.com/openmake/openmake_llm/issues/925)) ([bbb1c1c](https://github.com/openmake/openmake_llm/commit/bbb1c1cdacbd902f7dd476a89131b87629ffb22b))

## [1.70.0](https://github.com/openmake/openmake_llm/compare/v1.69.0...v1.70.0) (2026-09-17)


### ✨ 기능

* 카탈로그 후속 — 원격 MCP OAuth 클라이언트·HITL 승인 알림·관리자 비용/디버그 큐 UI·iOS 폴더·분기 (마이그레이션 153~155) ([#922](https://github.com/openmake/openmake_llm/issues/922)) ([57a697d](https://github.com/openmake/openmake_llm/commit/57a697dbc6442343a4f4259990be901fbced49d6))

## [1.69.0](https://github.com/openmake/openmake_llm/compare/v1.68.3...v1.69.0) (2026-09-17)


### ✨ 기능

* **cost:** 비용 원장·쿼터 예약·강등·승인 요청·명세서 (F25 PR-1~5, 마이그레이션 134~137) ([#911](https://github.com/openmake/openmake_llm/issues/911)) ([1b780e3](https://github.com/openmake/openmake_llm/commit/1b780e3e47871690009d54a3608471763f0e1c8a))
* **org:** 조직·테넌트 축 완성 Phase A~E — 활성 조직 컨텍스트·권한 판정 단일화·조직 공유·조직 정책·변경 이력·관리 콘솔 ([#909](https://github.com/openmake/openmake_llm/issues/909)) ([3b976b0](https://github.com/openmake/openmake_llm/commit/3b976b04f669f6c6ffaeeb0da69ef19fd23307fc))
* 카탈로그 보완 스택 — HITL·세션·MCP 워크플로·아티팩트 커넥터·관측/평가·UX 게이트웨이 (마이그레이션 131~133·138~149·156~158) ([#913](https://github.com/openmake/openmake_llm/issues/913)) ([81478ae](https://github.com/openmake/openmake_llm/commit/81478aec2220f634243cd3b9ab26ebb0e0474eb0))

## [1.68.3](https://github.com/openmake/openmake_llm/compare/v1.68.2...v1.68.3) (2026-09-16)


### 🐛 버그 수정

* **api:** 역할 배정 드롭다운의 비채팅 모델 제외 + 로컬 태그 오류 메시지 상한 ([#907](https://github.com/openmake/openmake_llm/issues/907)) ([aa95326](https://github.com/openmake/openmake_llm/commit/aa953260a98ddfa9658392fca80337b05674fced))

## [1.68.2](https://github.com/openmake/openmake_llm/compare/v1.68.1...v1.68.2) (2026-09-15)


### 🐛 버그 수정

* **api:** SSE 채팅의 ProviderError 코드 전달 + chatgpt 역할 클라이언트 상태표를 공유 맵으로 통합 ([#905](https://github.com/openmake/openmake_llm/issues/905)) ([d3be717](https://github.com/openmake/openmake_llm/commit/d3be71745969945f5a79e630cb8d263dde54bf8e))

## [1.68.1](https://github.com/openmake/openmake_llm/compare/v1.68.0...v1.68.1) (2026-09-15)


### 🐛 버그 수정

* **api:** REST 채팅의 ProviderError 를 글로벌 핸들러가 코드별 상태로 매핑 ([#903](https://github.com/openmake/openmake_llm/issues/903)) ([72487fd](https://github.com/openmake/openmake_llm/commit/72487fd63544355d68f29d52b291ace734960ddb))

## [1.68.0](https://github.com/openmake/openmake_llm/compare/v1.67.0...v1.68.0) (2026-09-15)


### ✨ 기능

* 로드맵 3~5단계 — Execution Graph 증분·메모리 범위 메타데이터·Control Plane 기초 ([#901](https://github.com/openmake/openmake_llm/issues/901)) ([4f0e11f](https://github.com/openmake/openmake_llm/commit/4f0e11f8bff1e3c5405dc7542de77384d5baf2ad))

## [1.67.0](https://github.com/openmake/openmake_llm/compare/v1.66.0...v1.67.0) (2026-09-15)


### ✨ 기능

* **agent-task:** 정책 계층 — 도구 위험 등급표로 승인 판정 + 승인함에 등급 표시 ([#899](https://github.com/openmake/openmake_llm/issues/899)) ([d284e5a](https://github.com/openmake/openmake_llm/commit/d284e5a1b74caa3bbbd2489b84a13bfbe0e4b7ac))

## [1.66.0](https://github.com/openmake/openmake_llm/compare/v1.65.10...v1.66.0) (2026-09-15)


### ✨ 기능

* **agent-task:** 런타임 내구성 1단계 — 승인 대기 영속·상태 전이 강제·도구 호출 저널·계획 복원 ([#897](https://github.com/openmake/openmake_llm/issues/897)) ([516a215](https://github.com/openmake/openmake_llm/commit/516a215035e1599b6facde5be0d8b84a94c6f226))

## [1.65.10](https://github.com/openmake/openmake_llm/compare/v1.65.9...v1.65.10) (2026-09-15)


### 🐛 버그 수정

* **agent-task:** 브라우저 러너가 빈 allowlist 를 전면 차단하던 결함 ([#895](https://github.com/openmake/openmake_llm/issues/895)) ([964e892](https://github.com/openmake/openmake_llm/commit/964e892bc2d09022881559e012d8599ba6fe81de))

## [1.65.9](https://github.com/openmake/openmake_llm/compare/v1.65.8...v1.65.9) (2026-09-15)


### 🐛 버그 수정

* **agent-task:** 실행기별 작업환경 안내·도구 노출 + 브라우저 러너 빈 페이지 가드 ([#893](https://github.com/openmake/openmake_llm/issues/893)) ([c2b891c](https://github.com/openmake/openmake_llm/commit/c2b891cfdd6fd735bcecb9221d1b04c7b61e47a9))

## [1.65.8](https://github.com/openmake/openmake_llm/compare/v1.65.7...v1.65.8) (2026-09-15)


### 🐛 버그 수정

* **chat:** 사고 요약용 언어 판정의 중복 결정 로그 제거 ([#891](https://github.com/openmake/openmake_llm/issues/891)) ([e3c6e61](https://github.com/openmake/openmake_llm/commit/e3c6e616f1abdaeac0a74d90552b3881417704c1))

## [1.65.7](https://github.com/openmake/openmake_llm/compare/v1.65.6...v1.65.7) (2026-09-15)


### 🐛 버그 수정

* **i18n:** 영문 UI 에 한국어가 섞이던 3곳 — 사고 요약·오케스트레이터 text.reason 머리글·에이전트/스킬 칩 ([#889](https://github.com/openmake/openmake_llm/issues/889)) ([116d4da](https://github.com/openmake/openmake_llm/commit/116d4dae91606f714b737d0210fcd1e8019dd51d))

## [1.65.6](https://github.com/openmake/openmake_llm/compare/v1.65.5...v1.65.6) (2026-09-15)


### 🐛 버그 수정

* **chat:** 도구 결과 text 를 이스케이프 없이 이어 8000자 캡 절단 방지 — open-design list_projects 마지막 프로젝트 누락 ([#887](https://github.com/openmake/openmake_llm/issues/887)) ([f243bf1](https://github.com/openmake/openmake_llm/commit/f243bf1627cafd826081d91cc57d521ceb172089))

## [1.65.5](https://github.com/openmake/openmake_llm/compare/v1.65.4...v1.65.5) (2026-09-14)


### 🐛 버그 수정

* **mcp:** 외부 MCP 도구의 호스트 프로토콜 인자 숨김 — open-design pluginWorkflowId 날조로 모든 호출 404 ([#885](https://github.com/openmake/openmake_llm/issues/885)) ([fc11664](https://github.com/openmake/openmake_llm/commit/fc116642e93797df080c00f0bf58a9b3029e83c8))

## [1.65.4](https://github.com/openmake/openmake_llm/compare/v1.65.3...v1.65.4) (2026-09-14)


### 🐛 버그 수정

* **mcp:** stdio 사용자 MCP 가 스스로 종료하면 감지·재기동 — open-design 유휴 종료 후 첫 도구 호출 Not connected ([#883](https://github.com/openmake/openmake_llm/issues/883)) ([e98a379](https://github.com/openmake/openmake_llm/commit/e98a37969ab218e119396359250fb08698571950))

## [1.65.3](https://github.com/openmake/openmake_llm/compare/v1.65.2...v1.65.3) (2026-09-14)


### 🐛 버그 수정

* **orchestrator:** Planner 가 빠뜨린 첨부 id 결정적 보정 — 이미지·오디오 단일 첨부, 영상 job 조회 ([#880](https://github.com/openmake/openmake_llm/issues/880)) ([61a25bb](https://github.com/openmake/openmake_llm/commit/61a25bbd16c56606a00c75d20a639a880ec00a03))

## [1.65.2](https://github.com/openmake/openmake_llm/compare/v1.65.1...v1.65.2) (2026-09-14)


### 🐛 버그 수정

* **orchestrator:** Planner 시간 초과·전송 오류는 재시도 없이 fail-open·타임아웃 15초 + 라우터 사유 로그 정리 ([#879](https://github.com/openmake/openmake_llm/issues/879)) ([013d820](https://github.com/openmake/openmake_llm/commit/013d820107ebc648f227b2a7eb51a3da7793f5eb))

## [1.65.1](https://github.com/openmake/openmake_llm/compare/v1.65.0...v1.65.1) (2026-09-14)


### 🐛 버그 수정

* **agents:** LLM 에이전트 라우터 출력 축소·타임아웃 시 요청 중단 — 27B 전환 후 전부 폴백되던 회귀 ([#877](https://github.com/openmake/openmake_llm/issues/877)) ([d176aab](https://github.com/openmake/openmake_llm/commit/d176aab61d4818a78692f81490a8deae2d831169))

## [1.65.0](https://github.com/openmake/openmake_llm/compare/v1.64.0...v1.65.0) (2026-09-14)


### ✨ 기능

* **chat:** 사용자 확인 질문 도구 ask_user — 모호한 산출물 요청은 질문으로 턴 종료 ([#875](https://github.com/openmake/openmake_llm/issues/875)) ([fa5935e](https://github.com/openmake/openmake_llm/commit/fa5935e1c165a20247de0046045baf176923e8f9))

## [1.64.0](https://github.com/openmake/openmake_llm/compare/v1.63.0...v1.64.0) (2026-09-14)


### ✨ 기능

* **i18n:** 독일어(de) UI 지원 — 웹 next-intl + 컴패니언 ([#873](https://github.com/openmake/openmake_llm/issues/873)) ([c70b436](https://github.com/openmake/openmake_llm/commit/c70b436483030962daeac4e6bf4b0605999c679b))

## [1.63.0](https://github.com/openmake/openmake_llm/compare/v1.62.3...v1.63.0) (2026-09-14)


### ✨ 기능

* **providers:** OrcaRouter 외부 provider 추가 — BYOK + LiteLLM 게이트웨이 wildcard ([#871](https://github.com/openmake/openmake_llm/issues/871)) ([4994fe5](https://github.com/openmake/openmake_llm/commit/4994fe52028a3595cc3c46648ca0349d9c709b9b))

## [1.62.3](https://github.com/openmake/openmake_llm/compare/v1.62.2...v1.62.3) (2026-09-13)


### 🐛 버그 수정

* **security:** 09-02 이후 변경분 보안 재점검 — 브리지 심링크 write 탈출·스킬 export IDOR 등 7건 + 의존성 3종 ([#864](https://github.com/openmake/openmake_llm/issues/864)) ([378d501](https://github.com/openmake/openmake_llm/commit/378d50106369668a27108eebb7d9158d9cd42cd7))

## [1.62.2](https://github.com/openmake/openmake_llm/compare/v1.62.1...v1.62.2) (2026-09-12)


### 🐛 버그 수정

* **web:** 워크스페이스 페이지 3곳에 스크롤 컨테이너 누락 — 내용이 잘려 접근 불가 ([#862](https://github.com/openmake/openmake_llm/issues/862)) ([87220fc](https://github.com/openmake/openmake_llm/commit/87220fc441022e670d88bb2a9016daf4041d0d53))

## [1.62.1](https://github.com/openmake/openmake_llm/compare/v1.62.0...v1.62.1) (2026-09-12)


### 🐛 버그 수정

* **docs:** quickstart curl 의 ${base} 미치환 교정 (배포 후 실측) ([#860](https://github.com/openmake/openmake_llm/issues/860)) ([51915ce](https://github.com/openmake/openmake_llm/commit/51915ceea2b8ebea74b70db4116973401a686d21))
* **research:** 딥리서치 완주 차단 3건 — 분해 JSON 절단·합성 타임아웃 전멸·보고서 abort 무효 ([#861](https://github.com/openmake/openmake_llm/issues/861)) ([b710fbc](https://github.com/openmake/openmake_llm/commit/b710fbc4f82288a602c2e15ec5439f2b23469f2f))
* **web,api:** 라이브 점검 결함 4건 — 웹 푸시 SW 부재·슬래시 확장문 저장·개발자 문서 플레이스홀더·404 메시지 이중화 ([#858](https://github.com/openmake/openmake_llm/issues/858)) ([ca0a639](https://github.com/openmake/openmake_llm/commit/ca0a639af24ee304b51daf78c4e35140f2a8d51c))

## [1.62.0](https://github.com/openmake/openmake_llm/compare/v1.61.1...v1.62.0) (2026-09-12)


### ✨ 기능

* **ios:** web 기능 격차 5건 반영 — 오케스트레이터 진행 카드·미디어 카드·서브에이전트 패널·모델 비교·기능별 모델 배정 ([#856](https://github.com/openmake/openmake_llm/issues/856)) ([6bd58d1](https://github.com/openmake/openmake_llm/commit/6bd58d14311b906250942f06c7f60e1e067afbdc))


### 🐛 버그 수정

* **db:** server-filesystem 미고정 시드를 2026.8.31 로 고정 — 신규 설치에서 122 가 no-op 이던 갭 (123) ([#855](https://github.com/openmake/openmake_llm/issues/855)) ([e6a044c](https://github.com/openmake/openmake_llm/commit/e6a044cd09514e67e4a513f8b128abc38740e679))

## [1.61.1](https://github.com/openmake/openmake_llm/compare/v1.61.0...v1.61.1) (2026-09-12)


### 🐛 버그 수정

* **chat:** 모바일 응답 후 하단 자동 스크롤 복구 ([7bb2db1](https://github.com/openmake/openmake_llm/commit/7bb2db17a213113931e2679ec0c75f19a6303e1c))

## [1.61.0](https://github.com/openmake/openmake_llm/compare/v1.60.5...v1.61.0) (2026-09-12)


### ✨ 기능

* **web:** 기능별 모델 배정 6그룹 UI (텍스트·비전/코드/이미지/음성/음악/영상) ([#851](https://github.com/openmake/openmake_llm/issues/851)) ([8ab70f5](https://github.com/openmake/openmake_llm/commit/8ab70f5529dd79e69fe5b9e572122da007479634))

## [1.60.5](https://github.com/openmake/openmake_llm/compare/v1.60.4...v1.60.5) (2026-09-12)


### ⚡ 성능

* **orchestrator:** 영상 완료/실패 markDone 을 fire-and-forget 으로 — 응답이 DB 쓰기를 기다리지 않는다 ([#849](https://github.com/openmake/openmake_llm/issues/849)) ([daa7184](https://github.com/openmake/openmake_llm/commit/daa7184f07fbdf8597834c523238c137ad2d93a1))

## [1.60.4](https://github.com/openmake/openmake_llm/compare/v1.60.3...v1.60.4) (2026-09-12)


### 🐛 버그 수정

* **orchestrator:** 실행 경계 보안 정리 — 서버 공용 키 정책·비용 주체, 영상 보정 범위·대화 귀속, job 저장 보장, 저장본 조회 분리, 이미지 모드 공통 경계 ([#847](https://github.com/openmake/openmake_llm/issues/847)) ([569fa76](https://github.com/openmake/openmake_llm/commit/569fa768ef68831e006e7d1fa72bdf6ea3a090ca))

## [1.60.3](https://github.com/openmake/openmake_llm/compare/v1.60.2...v1.60.3) (2026-09-12)


### 🐛 버그 수정

* **orchestrator:** 영상 job 첨부가 있는 영상 후속 발화는 Planner 가 simple 로 답해도 재조회 1작업으로 보정 ([#845](https://github.com/openmake/openmake_llm/issues/845)) ([6ffba4a](https://github.com/openmake/openmake_llm/commit/6ffba4ad1f71e40925c9aac826dc7205802eafb0))

## [1.60.2](https://github.com/openmake/openmake_llm/compare/v1.60.1...v1.60.2) (2026-09-12)


### 🐛 버그 수정

* **orchestrator:** 완료·저장된 영상 job 은 재조회·재다운로드 없이 즉시 반환 + 내려받기 재시도(2회) ([#843](https://github.com/openmake/openmake_llm/issues/843)) ([fa9a574](https://github.com/openmake/openmake_llm/commit/fa9a57466f942ed1de5be5d960bc6ce14adedc76))

## [1.60.1](https://github.com/openmake/openmake_llm/compare/v1.60.0...v1.60.1) (2026-09-12)


### 🐛 버그 수정

* **orchestrator:** 영상 산출물 내려받기 상한 120s→600s + 내려받기 실패는 실패가 아니라 pending 으로 보존 ([#841](https://github.com/openmake/openmake_llm/issues/841)) ([2d37b6a](https://github.com/openmake/openmake_llm/commit/2d37b6ae713daa571967176c6d2ceddebc774b70))

## [1.60.0](https://github.com/openmake/openmake_llm/compare/v1.59.0...v1.60.0) (2026-09-11)


### ✨ 기능

* **install:** 기본 설치 위치 ~/.openmake/chat + --instance NAME 병행 설치 + --public-url + db-dump/db-restore ([#812](https://github.com/openmake/openmake_llm/issues/812)) ([249fc73](https://github.com/openmake/openmake_llm/commit/249fc730b66aad5880cf6ca472a0f7c12aa0df4a))

## [1.59.0](https://github.com/openmake/openmake_llm/compare/v1.58.1...v1.59.0) (2026-09-11)


### ✨ 기능

* **orchestrator:** 멀티모달 오케스트레이터 — Planner → capability 병렬 실행 → 채팅 모델 종합 (모달리티 축 교체) ([#837](https://github.com/openmake/openmake_llm/issues/837)) ([fd2d7c6](https://github.com/openmake/openmake_llm/commit/fd2d7c65013fa81427f258d7e273029dcf3181dd))

## [1.58.1](https://github.com/openmake/openmake_llm/compare/v1.58.0...v1.58.1) (2026-09-11)


### 🐛 버그 수정

* **modality:** vision 브리지 기록을 ctx.enhancedMessage 에도 반영 ([#834](https://github.com/openmake/openmake_llm/issues/834)) ([323c376](https://github.com/openmake/openmake_llm/commit/323c376f3d67204c40eb0fabbca1fb82bbb1b91e))

## [1.58.0](https://github.com/openmake/openmake_llm/compare/v1.57.0...v1.58.0) (2026-09-11)


### ✨ 기능

* **modality:** 모달리티별 모델 배정 축(이미지·비전·영상·오디오) + IMAGE_GEN_MODEL 고정 호출 폐기 ([#832](https://github.com/openmake/openmake_llm/issues/832)) ([8d6174d](https://github.com/openmake/openmake_llm/commit/8d6174d8c641938c6484c85522928e2745e17cce))

## [1.57.0](https://github.com/openmake/openmake_llm/compare/v1.56.1...v1.57.0) (2026-09-11)


### ✨ 기능

* **desktop:** macOS 는 네이티브 컴패니언만 — 업데이트 기본값·게시·브리지에서 Electron 제거 ([#830](https://github.com/openmake/openmake_llm/issues/830)) ([7472031](https://github.com/openmake/openmake_llm/commit/7472031e4c11ff15bacb9be05586d292ebfffb48))
* **local-bridge:** 승인 대기를 컴패니언 네이티브 알림으로 + 컴패니언 다국어·키 안내 정정 ([#828](https://github.com/openmake/openmake_llm/issues/828)) ([2486795](https://github.com/openmake/openmake_llm/commit/24867954c323da5cf896f41356b31472e67391f3))


### 🐛 버그 수정

* **ws:** 인증 완료 전 도착한 메시지를 버리지 않는다 ([#831](https://github.com/openmake/openmake_llm/issues/831)) ([9da6553](https://github.com/openmake/openmake_llm/commit/9da655372338a2d1710aa3f8993a2d77ac474045))

## [1.56.1](https://github.com/openmake/openmake_llm/compare/v1.56.0...v1.56.1) (2026-09-11)


### 🐛 버그 수정

* **chat:** 추론만 온 턴을 답변으로 승격하지 않음 + 한글 자모 입력을 한국어로 판정 ([#826](https://github.com/openmake/openmake_llm/issues/826)) ([fe199cd](https://github.com/openmake/openmake_llm/commit/fe199cdbc11dcdfcb96c598afb12beecb18c774b))

## [1.56.0](https://github.com/openmake/openmake_llm/compare/v1.55.1...v1.56.0) (2026-09-11)


### ✨ 기능

* **skills:** 주입 합계 상한을 넘는 턴은 어떤 스킬을 불러올지 모델이 고른다 ([#825](https://github.com/openmake/openmake_llm/issues/825)) ([e61b567](https://github.com/openmake/openmake_llm/commit/e61b567ec16e7bf240a10e72c95bb0766e0a8ab4))


### 🐛 버그 수정

* **api:** 코드·비밀값이 들어오는 긴 텍스트 필드의 공백 정제 해제 ([#824](https://github.com/openmake/openmake_llm/issues/824)) ([10de6c0](https://github.com/openmake/openmake_llm/commit/10de6c070df971f3311423487a9469002b51ab05))
* **config:** NVIDIA NIM 무료 엔드포인트 22개로 카탈로그 갱신 ([#820](https://github.com/openmake/openmake_llm/issues/820)) ([20229c0](https://github.com/openmake/openmake_llm/commit/20229c05e736eb43d893c0ca34b4ee4d64077c92))
* **skills:** load_skill 카탈로그에서 에이전트 페르소나 스킬 제외 + 상한 초과 경고 ([#822](https://github.com/openmake/openmake_llm/issues/822)) ([283609a](https://github.com/openmake/openmake_llm/commit/283609a1d3e16b348ab8788c1f84f36402d139fb))
* **skills:** 스킬 본문 저장 시 들여쓰기 소실 + 트리거 보존 + 주입 순서 정정 ([#823](https://github.com/openmake/openmake_llm/issues/823)) ([cfbb819](https://github.com/openmake/openmake_llm/commit/cfbb819cef4e0c8a4219471d9db71acfe24c3739))

## [1.55.1](https://github.com/openmake/openmake_llm/compare/v1.55.0...v1.55.1) (2026-09-09)


### 🐛 버그 수정

* **agent-task:** 서브에이전트가 120초 타임아웃 3회 재시도로 죽던 문제 ([#817](https://github.com/openmake/openmake_llm/issues/817)) ([d82e1be](https://github.com/openmake/openmake_llm/commit/d82e1bef2d57386fc412f5add530e6be13563e66))

## [1.55.0](https://github.com/openmake/openmake_llm/compare/v1.54.0...v1.55.0) (2026-09-09)


### ✨ 기능

* **agent-task:** 병렬 에이전트 진행을 실시간 상태로 노출 ([#813](https://github.com/openmake/openmake_llm/issues/813)) ([4135559](https://github.com/openmake/openmake_llm/commit/41355598ab9421117b39c53d22ca3d0a825e5e29))


### 🐛 버그 수정

* **agent-task:** 빈 배열 인자로 도구 호출이 무한 반복되던 문제 + 병렬 안내 실측 반영 ([#816](https://github.com/openmake/openmake_llm/issues/816)) ([354d57e](https://github.com/openmake/openmake_llm/commit/354d57e718b2b32f4ef57e892c8e76fd2a75778f))
* **llm:** 해결 불가 $ref 로 죽던 도구 요청 + 작업 경로 병렬 분담 유도 ([#815](https://github.com/openmake/openmake_llm/issues/815)) ([b935896](https://github.com/openmake/openmake_llm/commit/b9358967c474e55718ce840b61434e9210e3f08b))

## [1.54.0](https://github.com/openmake/openmake_llm/compare/v1.53.0...v1.54.0) (2026-09-09)


### ✨ 기능

* **compare:** 모델 비교 모드에 Thinking 토글 추가 ([#810](https://github.com/openmake/openmake_llm/issues/810)) ([8259d46](https://github.com/openmake/openmake_llm/commit/8259d46a395b37fdd98cc974cfd0f8c90fbd4373))

## [1.53.0](https://github.com/openmake/openmake_llm/compare/v1.52.2...v1.53.0) (2026-09-09)


### ✨ 기능

* **chat:** 모델 비교 모드 — 두 모델이 같은 질문에 동시에 답하는 분할 화면 (/compare) ([#807](https://github.com/openmake/openmake_llm/issues/807)) ([8faa049](https://github.com/openmake/openmake_llm/commit/8faa0499cf147a4a4b10afc698b5fe2ec3b31215))

## [1.52.2](https://github.com/openmake/openmake_llm/compare/v1.52.1...v1.52.2) (2026-09-08)


### 🐛 버그 수정

* **agent-task:** 마무리 턴 시간 예산 보장·timeout 분류·부분 본문 보존 + 접기 스텁 재읽기 유도 제거 ([#804](https://github.com/openmake/openmake_llm/issues/804)) ([eb630f2](https://github.com/openmake/openmake_llm/commit/eb630f28fed545796b39f423eadceb889acd9428))

## [1.52.1](https://github.com/openmake/openmake_llm/compare/v1.52.0...v1.52.1) (2026-09-08)


### 🐛 버그 수정

* **memory:** memoryLearning 설정 조회 실패 시 fail-closed — 장애가 사용자가 끈 메모리를 다시 켜지 않게 ([#802](https://github.com/openmake/openmake_llm/issues/802)) ([446b049](https://github.com/openmake/openmake_llm/commit/446b049484d47b0cede96b32e85c145528abd3cd))

## [1.52.0](https://github.com/openmake/openmake_llm/compare/v1.51.2...v1.52.0) (2026-09-08)


### ✨ 기능

* **mcp:** 공공데이터포털(data.go.kr) MCP 서버 4종을 카탈로그에 시드(116) ([#800](https://github.com/openmake/openmake_llm/issues/800)) ([f880798](https://github.com/openmake/openmake_llm/commit/f880798eeb10d5c97f23f63fdd3c5786215176ed))

## [1.51.2](https://github.com/openmake/openmake_llm/compare/v1.51.1...v1.51.2) (2026-09-08)


### 🐛 버그 수정

* **web:** 역할별 모델 배정 select 가 흰 배경·회색 글자로 열리던 문제 — 미정의 색 클래스 교체 ([#798](https://github.com/openmake/openmake_llm/issues/798)) ([9cb426e](https://github.com/openmake/openmake_llm/commit/9cb426e7383b32868bcc78048d3bbd08f5bda306))

## [1.51.1](https://github.com/openmake/openmake_llm/compare/v1.51.0...v1.51.1) (2026-09-08)


### 🐛 버그 수정

* **model-roles:** 외부 provider 역할 배정 점검 — B.AI 프로브 max_tokens 하한 + 목록 밖 배정값 표시 ([#796](https://github.com/openmake/openmake_llm/issues/796)) ([5c6d428](https://github.com/openmake/openmake_llm/commit/5c6d428e0bd81df351cf8735b7b4c133d0a15270))

## [1.51.0](https://github.com/openmake/openmake_llm/compare/v1.50.3...v1.51.0) (2026-09-08)


### ✨ 기능

* **mcp:** OpenDART(금융감독원 전자공시) MCP 카탈로그 시드(115) + env_schema default + 동시 spawn dedupe ([#793](https://github.com/openmake/openmake_llm/issues/793)) ([3d75a31](https://github.com/openmake/openmake_llm/commit/3d75a3148c2b613affd14978f66d9502939c0fbc))
* **settings:** 모델&응답 API 키 — 공급자 로고 스트립 + 키 발급/인증 페이지 링크 (www "이런 AI를 연결합니다" 정합) ([#794](https://github.com/openmake/openmake_llm/issues/794)) ([7cce200](https://github.com/openmake/openmake_llm/commit/7cce200e2b8422102dd6a6a70a7794ea378b61e3))

## [1.50.3](https://github.com/openmake/openmake_llm/compare/v1.50.2...v1.50.3) (2026-09-07)


### 🐛 버그 수정

* **web:** 기본 모델 목록에 20B 컷 미적용(chatOnly) + 피커가 목록 밖 저장값을 "자동"으로 표시하던 문제 ([#791](https://github.com/openmake/openmake_llm/issues/791)) ([2dc855a](https://github.com/openmake/openmake_llm/commit/2dc855adee10063aedb013090dd40c13e3d58062))

## [1.50.2](https://github.com/openmake/openmake_llm/compare/v1.50.1...v1.50.2) (2026-09-07)


### 🐛 버그 수정

* **web:** 설정 저장 후 재로그인하면 기본 모델이 초기화되던 결함 — 게스트 목록 보정·미복원 2겹 ([#789](https://github.com/openmake/openmake_llm/issues/789)) ([575218d](https://github.com/openmake/openmake_llm/commit/575218d7a9897b494b1b826211dd18e67b5ce5ef))

## [1.50.1](https://github.com/openmake/openmake_llm/compare/v1.50.0...v1.50.1) (2026-09-07)


### 🐛 버그 수정

* **eval:** 실패 케이스 응답 앞부분을 결과·[FAIL] 로그에 남긴다 — nightly 실패 원인 사후 분석 불가 해소 ([#787](https://github.com/openmake/openmake_llm/issues/787)) ([1ba75ab](https://github.com/openmake/openmake_llm/commit/1ba75abb718b3c6af016764e2614d7f24026c6c6))

## [1.50.0](https://github.com/openmake/openmake_llm/compare/v1.49.0...v1.50.0) (2026-09-07)


### ✨ 기능

* **mcp:** 운영 지표 내장 도구 ops_metrics — 관리자 전용·읽기 전용·의도 게이트 ([#786](https://github.com/openmake/openmake_llm/issues/786)) ([1accbb7](https://github.com/openmake/openmake_llm/commit/1accbb768c25d65c1e66a53b8e3a1e3e564c5cb8))


### 🐛 버그 수정

* **export:** skill_manifests·custom_agents 조회의 옛 컬럼 참조 수정 — [#783](https://github.com/openmake/openmake_llm/issues/783) 의 failedCategories 가 배포 직후 드러낸 조용한 실패 2건 ([#785](https://github.com/openmake/openmake_llm/issues/785)) ([9ffeca8](https://github.com/openmake/openmake_llm/commit/9ffeca8c4c2bbad08864257ebb40b9998270ec52))
* **memory:** GDPR export user_memories 조회 결함 + 부분 export 관측 + 자동 추출·백필 audit + 주입 격리 테스트 ([#783](https://github.com/openmake/openmake_llm/issues/783)) ([0e62e47](https://github.com/openmake/openmake_llm/commit/0e62e4758c82623c5684093d9fd4eb156f0c3add))

## [1.49.0](https://github.com/openmake/openmake_llm/compare/v1.48.1...v1.49.0) (2026-09-06)


### ✨ 기능

* **llm:** 로컬 도구 정의에 strict:true — vLLM 이 인자 스키마를 디코딩 단계에서 강제 ([#781](https://github.com/openmake/openmake_llm/issues/781)) ([80b62fb](https://github.com/openmake/openmake_llm/commit/80b62fbdbbda7cfd7c1600f4218baf05a6a150d5))

## [1.48.1](https://github.com/openmake/openmake_llm/compare/v1.48.0...v1.48.1) (2026-09-06)


### 🐛 버그 수정

* **task-sandbox:** 자격증명 가드 리뷰 반영 — 목록 단일 출처·디렉토리 정합·셸 폴백 건너뛴 수 ([#779](https://github.com/openmake/openmake_llm/issues/779)) ([03b3482](https://github.com/openmake/openmake_llm/commit/03b34826c20d207dd13c109c8476deacfb5c745b))

## [1.48.0](https://github.com/openmake/openmake_llm/compare/v1.47.0...v1.48.0) (2026-09-06)


### ✨ 기능

* **task-sandbox:** 자격증명 파일 — 탐색 제외 + 쓰기 승인 상향 ([#777](https://github.com/openmake/openmake_llm/issues/777)) ([88101fe](https://github.com/openmake/openmake_llm/commit/88101fe745d9a8c31f65d3f4cf6f8d1348f730e8))

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
