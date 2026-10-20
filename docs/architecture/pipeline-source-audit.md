# 8단계 전환 소스 전수 조사

대상 기준: 2026-10-20 `origin/dev` 8c4fd1773ae827c384e47016999b13beed47c59a. 조사 범위는 저장소의 개발/CI/환경/검증/릴리스/관측 진입점 전체다. 비밀정보 파일과 node_modules는 제외했다. 앱 기능 전체를 새로 감사했다는 뜻이 아니다.

## 소스와 변경 책임

| 영역 | 기존 소스 | 조사 결과 / 반영 |
|---|---|---|
| 로컬 | package.json, scripts/env/omk.sh, tests/e2e, tests/web | 로컬 관련 검사 유지; dev 기능 검사도 명령으로 재사용 |
| PR·소스 CI | .github/workflows/ci.yml | PR/main/dev 소스·DB·빌드 검사 존재. 웹 단위 검사 추가, 테스트 job 토큰 읽기 전용으로 축소 |
| dev 기능 | scripts/ci, playwright.config.ts | 기존 CI에 실행 앱/브라우저 검사 없음. 격리 앱/DB/model fixture와 기본+변경 소스 검사 추가. 선택된 E2E만 api/web 대상으로 실행, 실제 통과 0건이면 차단. 전체 E2E 기본 실행 안 함 |
| 자동 병합 | .github/workflows/auto-merge.yml, scripts/pipeline/github.mjs | 없던 작업 PR 자동 구조 검사/자동 병합 추가. 신뢰된 기본 브랜치 코드만 권한 실행 |
| main 승격 | .github/workflows/promote.yml | dev push 즉시 실행·미설정 토큰 성공 skip·폐지된 omk/env-dev 의존 제거. 실제 병합 dev CI/current SHA로 승격 |
| tom | scripts/env/omk.sh, pipeline.sh | 기존 update/smoke 재사용. 필수 검증·실행 SHA 확인·잠금·hold 추가 |
| 검증 | scripts/release/{commands,runner,lib,verify-matrix,release-candidate} | 명령별 결과/skip 분류 도구 존재. 종료0이 승인인 것은 아님. staging의 필수 검증은 비어 있으면 차단하고 별도 SHA 근거 저장 |
| 사람 OK | scripts/env/omk.sh, pipeline.sh | 기존 health+HEAD만의 verify 강화. 명시적 approve --sha와 audit receipt 추가 |
| 릴리스 | release-please.yml, release-verified.yml | 기존 PR 생성·태그·SBOM/증명 유지. verified ref와 커밋별 metadata-only 검사 후 release PR 자동 병합 |
| 운영 | scripts/env/omk.sh, pipeline.sh | 기존 gate/backup/deploy/smoke 재사용; captured tag SHA와 실행 SHA 일치 검사, pipeline 게이트 강제 |
| 주기 검사 | 별도 저장소 [openmake/monitor](https://github.com/openmake/monitor)(비공개) | bean 실행기는 이 저장소에 없음. 대상·시나리오·환경변수 계정·명시적 PM2 스케줄. 사람 OK·배포 권한 없음 |
| 설치/Windows | install-smoke.yml, scripts/env/omk.ps1, install*/openmake_llm.sh | 기존 플랫폼 설치 경로 유지. Windows는 WSL로 같은 Bash 명령 전달. managed pipeline은 설치 후 활성화 |
| 문서 | scripts/env/README.md, docs/architecture/env-flow.html | 별도 dev 서버/단계별 사람 병합/수동 릴리스 설명을 새 8단계로 교체 |

## 라이브 대조에서 확인한 전환 전 차이

- dev/main 보호 규칙은 CI Gate만 필수, strict=false였다.
- 저장소 auto-merge 옵션은 true였지만 모든 작업 PR에 자동 설정하는 workflow는 없었다.
- promote 실행 39374514643은 OMK_PROMOTE_TOKEN 미설정으로 실제 승격을 건너뛰었다. workflow success는 승격 성공을 의미하지 않았다.
- 모니터 `/api/meta`는 기존 7단계였다. matrix에는 코드가 운영에 있어도 검증 릴리스가 미연결인 항목이 있었다.
- private 로컬 역할 원본 OPENMAKE-ROLES-2는 tom 수동 병합/별도 운영 승인 규칙으로 새 문서와 충돌했다. 현재 사용자 지시로 로컬 역할 원본은 OPENMAKE-ROLES-3으로 갱신했다. 원격 담당자의 적용/ACK와 실제 활성화는 별도 확인 대상이다.

## 소스만으로 완료할 수 없는 항목

자동화 credential 발급/등록, strict 보호 규칙 적용, 기본 브랜치 초기 도입, tom 필수 시나리오 설정/QA 계정/스케줄, 운영 pipeline 스케줄/OS 권한, bean 호스트 스케줄은 실제 환경 설정과 확인이 필요하다. 이 문서는 활성화 완료 목록이 아니다.

모니터 서버·UI·관측 에이전트·bean 실행기·버튼/증거 연동 계약은 별도 저장소 [openmake/monitor](https://github.com/openmake/monitor)(비공개, 조직 접근 필요)가 소유하며 이 저장소에 포함하지 않는다. 관측 에이전트는 SHA/runtime 관측만 제출한다. 이 저장소는 `omk env approve` CLI와 SHA 근거 출력만 제공하며, 모니터 endpoint/UI/수집 연결이나 원격 페이지 갱신을 주장하지 않는다.

## 검증 범위

단위 테스트는 stale SHA·실패/skip·부재 설정·동시 작업·tag 교체·의존성 위장·되돌린 코드·외부 QA 실패를 검증한다. 실제 임시 앱/DB 스모크와 전체 프로젝트 테스트 결과는 PR의 실행 로그/커밋에 연결한다. 소스 구현, 로컬 검증, CI 통과, 원격 활성화, 운영 완료를 따로 보고한다.
