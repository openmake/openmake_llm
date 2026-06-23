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
ARTIFACT_VIEWER_ORIGIN=http://localhost:8088          # 외부공개 시 Funnel :8443 URL 로 교체
ARTIFACT_VIEWER_DATA_DIR=/Volumes/MAC_APP/docker/openmake_llm/artifact-viewer/data
ARTIFACT_VIEWER_SIGNING_KEY=<운영 랜덤키>              # 미설정 시 JWT_SECRET 재사용
# ARTIFACT_VIEWER_TOKEN_TTL_SEC=3600
```

## 기동 (ops — 직접 실행)

```bash
# 1) 라이브러리 + bootstrap 준비 (1회 / 업데이트 시)
bash infra/artifact-viewer/fetch-vendor.sh

# 2) nginx 뷰어 컨테이너 기동
docker compose -f infra/artifact-viewer/docker-compose.yml up -d

# 3) 백엔드 .env 에 ARTIFACT_VIEWER_* 설정 후 재시작
#    (publish 시 self-contained HTML 이 data/a/<pubId>/index.html 로 export 됨)

# 확인
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8088/vendor/bootstrap.js   # 200
```

## 외부 공개 (Tailscale Funnel)

별도 오리진은 **포트로 분리**(origin = scheme+host+**port**). Funnel 허용 포트(443/8443/10000) 중
`:8443` 을 뷰어로:

```bash
# Caddy(또는 funnel) 가 :8443 → 컨테이너 :8088 로 라우팅하도록 구성한 뒤
tailscale funnel --bg --https=8443 http://localhost:8088
# ARTIFACT_VIEWER_ORIGIN 을 https://<node>.ts.net:8443 로 교체
```

> ⚠️ 같은 호스트의 다른 포트는 **별도 web origin** 이지만 쿠키는 호스트 단위로 공유될 수 있다.
> 본 뷰어는 strict CSP(`connect-src 'none'`)로 네트워크를 차단하고 앱 쿠키를 사용하지 않으므로
> 실질 무해하나, "완전 분리 호스트네임"이 필요하면 별도 DNS 가 필요하다.

## 보안 모델 요약

- **별도 오리진**: 앱(:3000/:52416)과 격리 — 쿠키/스토리지 분리
- **strict CSP**(meta): `default-src 'none'; connect-src 'none'; script-src 'self' [+sha256 / +'unsafe-eval'(react)]; img-src 'self' data:`
- **frame-ancestors 'none'**(nginx header): clickjacking 차단
- **외부요청 0**: 라이브러리 self-host(`/vendor`), 이미지 data: URI
- **접근제어**: `link`=share_token, `authenticated/private`=백엔드 발급 HMAC 단기토큰 (nginx auth_request 검증)
