# OpenMake MCP Runtime — 외부 MCP stdio 서버 격리 실행용 단일 이미지
#
# 목적: docker 기반 MCP 샌드박스(apps/api/src/mcp/sandbox-docker.ts)가
#   `docker run ... openmake-mcp-runtime <command> <args>` 로 외부 MCP 서버를 격리 실행.
#   npx(node) · uvx(python/uv) 두 런타임을 한 이미지에 담아 16개 stdio 서버 대부분을 커버.
#
# 빌드 (사용자 직접 — 호스트에서 1회):
#   docker build -t openmake-mcp-runtime:latest infra/mcp-runtime
#
# 캐시 볼륨(npx/uvx 재다운로드 방지)은 sandbox-docker.ts 가 런타임에 자동 마운트:
#   -v openmake-mcp-cache:/home/node/.cache   (named volume, 자동 생성)
FROM node:22-slim

# uv (uvx) + python — uvx 계열 MCP 서버용. uv 는 /usr/local/bin 에 설치(비-root 도 사용 가능).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && apt-get purge -y curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Chromium(Playwright) 실행 시스템 의존성 — 브라우저 사용 MCP 서버 지원 ──
# noapi-google-search-mcp 등 playwright 기반 서버가 chromium 을 launch 하려면 공유
# 라이브러리가 필요하다. 컨테이너는 --read-only + cap-drop ALL 이라 런타임 apt 설치가
# 불가(2026-07-25 7시 예약 리포트가 "Executable doesn't exist" 로 무산된 원인) → 이미지에
# 베이킹한다. 브라우저 본체는 서버별 캐시 볼륨(~/.cache/ms-playwright)에 설치·유지되며,
# 서버 패키지의 playwright 버전이 바뀌면 볼륨에 `python -m playwright install chromium`
# 재실행이 필요하다(버전-리비전 정합). 폰트는 스크린샷 한글 렌더용.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
        libatspi2.0-0 libx11-6 libxcb1 libxext6 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libxkbcommon0 libasound2 libcups2 libcairo2 libpango-1.0-0 \
        fonts-liberation fonts-noto-cjk \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# node:22 이미지 기본 제공 'node' 유저(uid 1000) 사용 — sandbox-docker 의 --user 1000:1000 과 일치.
# (useradd 로 새 uid 1000 생성하면 node 와 충돌해 실패하므로 기존 유저 재사용)
USER node
WORKDIR /home/node
ENV HOME=/home/node \
    NPM_CONFIG_CACHE=/home/node/.cache/npm \
    UV_CACHE_DIR=/home/node/.cache/uv
# .cache 를 node 소유로 미리 생성 — named volume(openmake-mcp-cache)이 빈 채로 처음
# 마운트될 때 이 디렉토리의 소유권(node:1000)을 상속해 uid 1000 이 캐시를 쓸 수 있게 함.
# (생성 안 하면 볼륨이 root 소유로 만들어져 npx/uvx 캐시 쓰기가 실패)
RUN mkdir -p /home/node/.cache/npm /home/node/.cache/uv

# net=none(네트워크 차단) 격리 대상 서버 사전설치 — Python REPL(arbitrary code 실행)을
# 컨테이너로 격리하면 런타임 uvx 다운로드가 불가하므로 이미지에 미리 설치한다.
# uv tool install 은 /home/node/.local 에 self-contained venv 로 설치 →
# 런타임에 볼륨 마운트되는 /home/node/.cache 와 분리되어 net=none(오프라인)에도 동작.
RUN uv tool install mcp-python-repl
ENV PATH=/home/node/.local/bin:${PATH}

# ── NotebookLM MCP 서버(notebooklm-mcp-cli) — 이미지에 baked ─────────────────
# jacob-bd/notebooklm-mcp-cli (PyPI). 쿠키 기반 내부 RPC 호출이라 런타임 브라우저가
# 불필요 — 인증은 NOTEBOOKLM_COOKIES env(-e 주입)만으로 초기화된다.
# 카탈로그(db/migrations/075_mcp_notebooklm_catalog.sql)는 `notebooklm-mcp` 로 실행.
# 런타임 uvx-fetch 없이 즉시 spawn 하도록 사전설치(버전 고정).
RUN uv tool install notebooklm-mcp-cli==0.8.9

# ── Kakao(Map/Search) MCP 서버 — 이미지에 baked ─────────────────────────────
# 벤더링된 수정 소스(vendor/kakao-api-mcp-server: deps 정정 + bin/shebang, ATTRIBUTION.md
# 참고)를 빌드해 /home/node/kakao-mcp 에 설치한다. mcp-python-repl 과 동일하게 이미지에
# 구워 런타임 npx-fetch 없이 즉시 spawn(빠름) + 네트워크 정책과 무관하게 동작.
# 카탈로그(db/migrations/063_mcp_kakao_catalog.sql)는
#   node /home/node/kakao-mcp/dist/index.js --mode=stdio
# 로 실행. 인증은 KAKAO_REST_API_KEY(컨테이너에 -e 로만 주입).
# npm install 이 prepare 스크립트(=tsc build)를 트리거해 dist 생성 → 이후 devDeps prune.
COPY --chown=node:node vendor/kakao-api-mcp-server/ /home/node/kakao-mcp/
RUN cd /home/node/kakao-mcp \
    && npm install --no-audit --no-fund \
    && npm prune --omit=dev \
    && rm -rf /home/node/.cache/npm/_cacache 2>/dev/null || true

# 진입점 없음 — sandbox-docker 가 `docker run ... <image> <command> <args>` 로
# 실행할 MCP command(npx/uvx/바이너리/사전설치 바이너리)를 직접 지정한다.
