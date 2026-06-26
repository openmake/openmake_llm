# OpenMake Task Runtime — Manus형 자율 에이전트의 영속 task 샌드박스 이미지
#
# 목적: services/task-sandbox 가 `docker run -d ... openmake-task-runtime tail -f /dev/null`
#   로 task별 영속 컨테이너(가상 컴퓨터)를 띄우고, 에이전트가 bash/python/파일도구를
#   `docker exec` 로 반복 실행한다. mcp-runtime(외부 MCP 격리, 일회성)과 별개.
#
# mcp-runtime 대비 차이: 실작업(repo clone·fetch·grep·build)이 상시 요구하는
#   git / curl / ripgrep 를 영구 포함(mcp-runtime 은 curl 을 purge 함).
#
# 빌드 (사용자 직접 — 호스트에서 1회):
#   docker build -t openmake-task-runtime:latest infra/task-runtime
#
# workspace 볼륨(/workspace)·캐시는 services/task-sandbox 가 런타임에 마운트.
FROM openmake-mcp-runtime:latest

# 실작업 상시 도구 — root 로 설치 후 비-root(node)로 복귀.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# workspace 마운트 지점 — node(uid 1000) 소유로 미리 생성(빈 볼륨 첫 마운트 시 소유권 상속).
RUN mkdir -p /workspace && chown node:node /workspace

USER node
WORKDIR /workspace
