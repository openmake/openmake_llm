# OpenMake Task Runtime — Manus형 자율 에이전트의 영속 task 샌드박스 이미지
#
# 목적: services/task-sandbox 가 `docker run -d ... openmake-task-runtime tail -f /dev/null`
#   로 task별 영속 컨테이너(가상 컴퓨터)를 띄우고, 에이전트가 bash/python/파일/브라우저
#   도구를 `docker exec` 로 반복 실행한다. (mcp-runtime 의 일회성 격리와 별개.)
#
# mcp-runtime 대비 차이: 실작업 상시 도구(git/curl/ripgrep) + G2 브라우저 자동화용
#   playwright chromium(컨테이너 내부 격리 실행).
#
# 빌드 (사용자 직접 — 호스트에서 1회, chromium 다운로드로 수 분 소요):
#   docker build -t openmake-task-runtime:latest infra/task-runtime
FROM openmake-mcp-runtime:latest

USER root
# 브라우저는 /opt 에 self-contained 설치(node uid 1000 도 읽기 가능). 캐시 분리.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# 실작업 상시 도구 + playwright chromium(+OS 의존성). root 설치 후 비-root 복귀.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep fonts-nanum \
    && mkdir -p /workspace /opt/browser \
    && chown node:node /workspace \
    && cd /opt/browser && npm init -y >/dev/null 2>&1 \
    && npm install playwright@1.49.0 \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /opt/ms-playwright /opt/browser \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 브라우저 액션 러너 — `node /opt/browser/browser-runner.mjs <actions.json>`.
COPY browser-runner.mjs /opt/browser/browser-runner.mjs
RUN chmod a+r /opt/browser/browser-runner.mjs

# Excel/PDF 산출물용 파이썬 라이브러리 — 격리 venv 에 빌드타임 베이킹.
# python_execute 가 실행하는 `python3` 가 이 venv 를 쓰도록 PATH 선두에 배치(코드 변경 0).
# main 샌드박스는 network=none 이라 런타임 pip 불가 → 이미지에 미리 설치(chromium 과 동일 패턴).
# 모두 pure-python(시스템 의존성 0): openpyxl=.xlsx, reportlab=구조적 PDF, fpdf2=경량 문서 PDF.
RUN uv venv /opt/pyenv \
    && VIRTUAL_ENV=/opt/pyenv uv pip install --no-cache openpyxl reportlab fpdf2 \
    && chmod -R a+rX /opt/pyenv
ENV PATH=/opt/pyenv/bin:${PATH}

USER node
WORKDIR /workspace
