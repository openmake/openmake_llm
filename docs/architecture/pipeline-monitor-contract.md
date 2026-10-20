# 모니터: 8단계 증거와 실사용 OK 버튼

## 범위와 현재 상태

기준: `workflow-map.html`의 8단계 및 2026-10-20 사용자 지시. 보드는 관측용이며 기존 7단계 RC/승인 자료를 새 8단계 완료로 재해석하지 않는다. 중앙 모니터 서버 소스는 현재 작업 공간에 없다. 아래는 **연동 계약**이며 HTTP endpoint가 이미 배포됐다는 뜻이 아니다.

## 6번 버튼

버튼 문구: **이 SHA 실사용 OK · verify 기록**. 대상은 tom/staging이며 전체 40자리 SHA와 검증 시각을 표시한다. 사용자는 해당 설치본을 직접 써본 다음 누른다. “재배포”, “최신 버전 승인”처럼 대상이 움직이는 표현은 사용하지 않는다.

권장 요청:

```http
POST /api/environments/tom/human-verify
Content-Type: application/json
X-CSRF-Token: <로그인 세션의 토큰>
Idempotency-Key: <고유 요청 ID>

{"expectedSha":"40자리 설치 SHA","validationFinishedAt":"표시한 검증 종료 시각","humanOk":true}
```

서버 구현 조건:

1. 인증된 사람의 승인 권한·CSRF·Origin을 검증한다. UI의 숨김/비활성만으로 권한을 대체하지 않는다. 서비스 봇·bean 자동 검사를 사람 OK로 사용하지 않는다.
2. 환경은 서버의 고정 allowlist `tom → staging`으로 해석한다. 클라이언트가 SSH host, 경로, 명령어, argv, 실행 계정, 토큰을 지정할 수 없게 한다.
3. 해당 환경의 hold SHA·최신 통과 validation·실행 빌드·디스크 빌드를 다시 확인한다. 요청의 검증 시각도 현재 근거와 일치해야 한다. 설치본이 바뀌면 HTTP 409로 거부하고 새 설치본의 재확인을 요청한다.
4. 서버가 신뢰한 실행 브리지에서 고정 argv를 사용한다. 예: `['omk','env','approve','staging','--sha',expectedSha,'--yes']`. 쉘 문자열을 만들지 않는다. 실행 계정의 권한은 staging 검증 ref 기록에 필요한 범위로 제한한다.
5. Idempotency-Key와 인증 actor, SHA를 묶어 재요청을 처리한다. 이미 동일 요청이 완료되면 이전 결과를 반환한다. 다른 SHA/actor로 같은 키를 재사용하면 거부한다. 실행 중에는 202와 작업 ID를 반환한다.
6. CLI가 검증 ref를 push하고 완료한 뒤에만 성공으로 기록한다. HTTP 요청 접수·큐 등록·명령 실행 시작을 완료로 표시하지 않는다. 실패는 종료 코드와 비밀정보 없는 이유를 반환한다.
7. 웹서버의 인증된 actor는 웹 감사 로그에 남긴다. CLI의 `USER`는 호스트 실행 계정이며 브라우저 사람의 신원 증명이 아니다. 두 값을 혼동하지 않는다.

응답 상태 예: `pending`, `running`, `passed`, `failed`, `stale`. 승인 버튼은 7~8번 배포 완료를 즉시 표시하지 않는다. 이후 릴리스/운영 증거를 별도로 기다린다.

## CLI와 근거

```bash
omk env approve staging --sha FULL_SHA --yes
```

내부 검증은 기존 `verify`와 같은 잠금·고정 SHA·검증 근거 검사이며, 성공한 뒤 `refs/omk/verified/FULL_SHA`를 기록한다. 로컬 `<환경 디렉터리>/.pipeline/human-verification.json`은 CLI 실행 actor·SHA·시각을 보관한다. Git ref와 실행 근거가 없으면 UI만 성공으로 만들지 않는다.

## 단계별 수집

| 단계 | 필요한 근거 |
|---|---|
| 1 | local 작업 PR, 커밋, 로컬 검사 결과 |
| 2 | PR 최신 head SHA, CI run, 구조 검사, dev merge SHA |
| 3 | dev **push** CI의 SHA/run 및 `logs/dev-checks.json`; PR CI와 구분 |
| 4 | 승격 PR head/base와 최신 조합 CI, main merge SHA |
| 5 | tom 설치/실행 SHA, 스모크, `.pipeline/validation.json`, hold SHA |
| 6 | 인증된 사람의 요청 감사 로그, human-verification receipt, verified ref |
| 7 | verify SHA → metadata-only 코드 계보 → 릴리스 PR/태그 SHA 및 릴리스 workflow |
| 8 | 고정 태그 SHA = 운영 설치/실행 SHA, 백업·스모크 결과 |
| bean | 대상·관측 SHA/버전·시각·시나리오·통과/실패. 배포 단계나 human OK와 분리 |

시각과 SHA를 동일 실행으로 연결한다. 짧은 SHA는 `identityPrecision: short-sha`로 표시하며 전체 SHA 확인으로 과장하지 않는다. 기록 미연결은 코드 미포함, 실패, 자동화 비활성을 뜻하지 않는다. 기존 `/api/meta`·`/api/matrix`의 7단계 필드를 유지해야 한다면 새 `schemaVersion`/별도 8단계 view로 추가해 기존 소비자를 깨지 않는다.

모니터 중앙 소스의 위치와 배포 절차를 확보한 뒤 endpoint/버튼/인증/감사/수집을 구현·검증해야 한다. 현재 로컬 observer의 observation 제출만으로 이 근거 전체를 수집했다고 판정하지 않는다.
