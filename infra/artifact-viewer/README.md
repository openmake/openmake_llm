# Artifact Viewer (C안 — 별도 오리진 엄격 CSP 뷰어)

publish 된 artifact 를 **self-contained HTML** 로 export → **별도 오리진 Docker nginx** 가
**strict CSP** 로 서빙. 외부요청 0(라이브러리 self-host), 인라인 실행 스크립트 0(데이터 아일랜드 +
벤더 bootstrap), 접근제어는 nginx `auth_request` → 백엔드 토큰 검증.

## 구성요소

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | 하드닝 nginx(`read_only`/`cap_drop`/`no-new-privileges`), `:8088` 노출, data 디렉토리 read-only 서빙 |
| `nginx.conf` | strict CSP 헤더(frame-ancestors 등) + `/a/<pubId>/` auth_request + `/vendor/` 공개 |
| `vendor/bootstrap.js` | 데이터 아일랜드 → 종류별 렌더 (svg/mermaid/chart/react/markdown/csv/code) |
| `fetch-vendor.sh` | 라이브러리(mermaid/chart/react/babel/marked) + bootstrap 을 `data/vendor` 에 준비 |

페이지별 `script-src`(해시 / `'self'` / react `'unsafe-eval'`)는 각 `index.html` 의 `<meta>` CSP 가
전담하므로 nginx 는 종류별 분기가 필요 없다.

## 백엔드 env (.env)

```bash
ARTIFACT_VIEWER_ENABLED=true
ARTIFACT_VIEWER_ORIGIN=http://localhost:8088          # 외부공개 시 전용 서브도메인 URL 로 교체
# ARTIFACT_VIEWER_DATA_DIR=/path/to/data            # 미설정 시 <repo>/data/artifact-viewer — compose·fetch-vendor.sh 도 같은 기본값
# ARTIFACT_VIEWER_PORT=8088                         # 뷰어 컨테이너의 호스트 포트 (compose 전용)
# ARTIFACT_VIEWER_BIND=127.0.0.1                    # 뷰어 포트의 호스트 바인딩 주소 (compose 전용) — 다른 장비가 http://<host>:8088 로 직접 열 때만 0.0.0.0
ARTIFACT_VIEWER_SIGNING_KEY=<운영 랜덤키>              # 미설정 시 JWT_SECRET 에서 파생한 별도 키 사용
# ARTIFACT_VIEWER_TOKEN_TTL_SEC=3600
```

## 기동 (ops — 직접 실행)

```bash
# 저장소 루트에서 실행한다. .env 에 사용자 지정 데이터 경로가 있으면
# vendor 준비에도 그 경로를 전달한다(.env 파일 자체를 source 하지 않는다).
# export ARTIFACT_VIEWER_DATA_DIR=/path/to/data

# 1) 라이브러리 + bootstrap 준비 (1회 / 업데이트 시)
bash infra/artifact-viewer/fetch-vendor.sh

# 2) nginx 뷰어 컨테이너 기동
docker --context colima-openmake compose --env-file .env -f infra/artifact-viewer/docker-compose.yml up -d  # macOS
# Linux/WSL: docker compose --env-file .env -f infra/artifact-viewer/docker-compose.yml up -d


# 3) 백엔드 .env 에 ARTIFACT_VIEWER_* 설정 후 재시작
#    (publish 시 self-contained HTML 이 data/a/<pubId>/index.html 로 export 됨)

# 확인
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8088/vendor/bootstrap.js   # 200
```

Docker 엔진을 옮긴 뒤에는 `docker inspect openmake-artifact-viewer` 의 `/srv`
마운트 원본이 백엔드의 `ARTIFACT_VIEWER_DATA_DIR` 과 같은지 확인한다. 미설정 시
백엔드 기본값은 `<repo>/data/artifact-viewer` 다. nginx 의 `/` 응답(의도적인 404)만으로
검증하지 말고, 기존 게시물의 **뷰어 열기**로 HTML·스크립트 렌더링과 접근 제어를 확인한다.
원본 게시 파일이 다른 경로에 남아 있다면 재게시하거나 복사하기 전에 마운트부터 대조한다.

## 외부 공개 (Cloudflare Tunnel)

앱(`chat.openmake.cc`)과 **별도 서브도메인**(`artifacts.openmake.cc`)으로 분리한다 —
cloudflared 터널 ingress 에 뷰어용 호스트네임을 하나 더 매핑해 컨테이너 :8088 로 보낸 뒤,
`ARTIFACT_VIEWER_ORIGIN` 을 그 URL 로 둔다. cloudflared 설정 파일과 DNS 레코드 작업은
git 에 두지 않는다(운영 호스트 로컬 보관).

```yaml
# cloudflared ingress (예시)
  - hostname: artifacts.openmake.cc
    service: http://localhost:8088
```

> 포트 분리(`:8443`)가 아니라 호스트네임 분리이므로, 앱 도메인과 쿠키 스코프가 완전히
> 갈린다. 본 뷰어는 strict CSP(`connect-src 'none'`)로 네트워크도 차단한다.

## 보안 모델 요약

- **별도 오리진**: 앱(:3000/:52416)과 격리 — 쿠키/스토리지 분리
- **strict CSP**(meta): `default-src 'none'; connect-src 'none'; script-src 'self' [+sha256 / +'unsafe-eval'(react)]; img-src 'self' data:`
- **frame-ancestors 'none'**(nginx header): clickjacking 차단
- **외부요청 0**: 라이브러리 self-host(`/vendor`), 이미지 data: URI
- **접근제어**: `link`=share_token, `authenticated/private`=백엔드 발급 HMAC 단기토큰 (nginx auth_request 검증)
