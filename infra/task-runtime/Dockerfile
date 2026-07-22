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
    && npm install playwright@1.61.1 \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /opt/ms-playwright /opt/browser \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 검색 등 일부 도구의 playwright 는 PLAYWRIGHT_BROWSERS_PATH 를 안 물고 기본 캐시
# (/home/node/.cache/ms-playwright)에서 브라우저를 찾는다 → /opt 설치본으로 심링크해 양쪽 해석.
RUN mkdir -p /home/node/.cache \
    && ln -sfn /opt/ms-playwright /home/node/.cache/ms-playwright \
    && chown -R node:node /home/node/.cache

# 브라우저 액션 러너 — `node /opt/browser/browser-runner.mjs <actions.json>`.
COPY browser-runner.mjs /opt/browser/browser-runner.mjs
RUN chmod a+r /opt/browser/browser-runner.mjs

# 리포트 디자인 템플릿(Open Design ai-trend-daily) + 렌더러 — 픽셀-정합 재현용.
# network=none 샌드박스라 런타임 fetch 불가 → 고정 디자인을 이미지에 베이킹. 에이전트는
# data.json 만 생성하고 render_report.py 가 {{TOKEN}} 을 결정적으로 치환 → CSS/구조 불변.
COPY report-template/ /opt/report-template/
RUN chmod -R a+rX /opt/report-template

# 오피스/PDF 산출물용 파이썬 라이브러리 — 격리 venv 에 빌드타임 베이킹.
# python_execute 가 실행하는 `python3` 가 이 venv 를 쓰도록 PATH 선두에 배치(코드 변경 0).
# main 샌드박스는 network=none 이라 런타임 pip 불가 → 이미지에 미리 설치(chromium 과 동일 패턴).
# openpyxl=.xlsx 읽기/쓰기/편집, python-docx=.docx 읽기/쓰기/편집, python-pptx=.pptx 읽기/쓰기/편집,
# reportlab/fpdf2=PDF 생성, pypdf=PDF 조작(병합/분할/회전/워터마크/폼). lxml·Pillow(docx/pptx 의존)는
# manylinux wheel 로 시스템 의존성 없이 설치.
RUN uv venv /opt/pyenv \
    && VIRTUAL_ENV=/opt/pyenv uv pip install --no-cache openpyxl reportlab fpdf2 python-docx python-pptx pypdf \
    && chmod -R a+rX /opt/pyenv
ENV PATH=/opt/pyenv/bin:${PATH}

USER node
WORKDIR /workspace
