# OpenMake Egress Proxy — 브라우저 컨테이너 네트워크 레벨 도메인 allowlist (Manus 하드닝).
#
# 브라우저 전용 task 컨테이너는 internal Docker 네트워크(인터넷 차단)에만 연결되고, 이 프록시를
# 통해서만 외부로 나간다. 프록시는 양쪽(internal + bridge)에 연결돼 allowlist 통과 트래픽만 포워딩.
#
# 빌드 (사용자 직접 — 1회):
#   docker build -t openmake-egress-proxy:latest infra/egress-proxy
#
# 실행은 services/task-sandbox/egress-proxy.ts 가 런타임에 관리(ensureEgressProxy).
FROM node:22-slim
USER node
WORKDIR /app
COPY proxy.mjs /app/proxy.mjs
EXPOSE 8888
CMD ["node", "/app/proxy.mjs"]
