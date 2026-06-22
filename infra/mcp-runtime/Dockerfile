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

# 진입점 없음 — sandbox-docker 가 `docker run ... <image> <command> <args>` 로
# 실행할 MCP command(npx/uvx/바이너리/사전설치 바이너리)를 직접 지정한다.
