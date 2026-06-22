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
#   -v openmake-mcp-cache:/home/mcp/.cache   (named volume, 자동 생성)
FROM node:22-slim

# uv (uvx) + python — uvx 계열 MCP 서버용. uv 는 /usr/local/bin 에 설치(비-root 도 사용 가능).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl python3 \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && apt-get purge -y curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 비-root 실행 사용자 (sandbox-docker 의 --user 1000:1000 과 일치)
RUN useradd --create-home --uid 1000 mcp
USER mcp
WORKDIR /home/mcp
ENV HOME=/home/mcp \
    NPM_CONFIG_CACHE=/home/mcp/.cache/npm \
    UV_CACHE_DIR=/home/mcp/.cache/uv

# 진입점 없음 — sandbox-docker 가 `docker run ... <image> <command> <args>` 로
# 실행할 MCP command(npx/uvx/바이너리)를 직접 지정한다.
