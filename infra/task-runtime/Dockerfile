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
# tesseract-ocr(+kor): 스캔 PDF OCR — 텍스트 레이어 없는 문서(이미지 스캔본)는 pypdf 로
# 추출이 불가능해 goal_incomplete 로 실패하던 갭(2026-08-04, 2040인천 도시기본계획 688p 실사례).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates ripgrep fonts-nanum \
       tesseract-ocr tesseract-ocr-kor \
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
# PyMuPDF=PDF 페이지→이미지 렌더(poppler 불요, 스캔본 OCR 전처리), pytesseract=tesseract 바인딩.
# pandas/pdfplumber/olefile/requests=운영 실측 보강(2026-08-11, agent_task_steps 의
# ModuleNotFoundError 집계 상위 — 데이터 분석·PDF 표 추출·HWP/OLE 파싱에서 부재 실패).
RUN uv venv /opt/pyenv \
    && VIRTUAL_ENV=/opt/pyenv uv pip install --no-cache openpyxl reportlab fpdf2 python-docx python-pptx pypdf \
       PyMuPDF pytesseract \
       pandas pdfplumber olefile requests pytest \
    && chmod -R a+rX /opt/pyenv
ENV PATH=/opt/pyenv/bin:${PATH}

# 고품질 PDF 본문 추출(opendataloader-pdf, Java CLI) — 호스트 doc-extractor 와 동일 엔진.
# 생성 시점 서버 추출이 생략되는 대형 PDF(>30MB, CF 100s 가드)를 에이전트가 컨테이너 안에서
# 레이아웃·표 인식 품질로 직접 추출하는 용도(pypdf 는 단순 텍스트라 표/헤딩 구조가 깨짐).
# network=none 이라 빌드타임 베이킹. 버전은 apps/api 의존성과 동기 유지(2.5.0).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/pdf && cd /opt/pdf && npm init -y >/dev/null 2>&1 \
    && npm install @opendataloader/pdf@2.5.0 \
    && ln -s /opt/pdf/node_modules/.bin/opendataloader-pdf /usr/local/bin/opendataloader-pdf \
    && chmod -R a+rX /opt/pdf

# 다국어 분석·산출 (2026-08-08) — 어떤 언어의 문서든 OCR(분석)·PDF 생성·브라우저 렌더가 되도록.
# - tesseract-ocr-all: 전체 언어팩(기존 eng+kor 뿐 → 호스트 brew 163개와 정합). 스캔 PDF 다국어 OCR.
# - fonts-noto-core: 아랍·히브리·타이·인도계 등 비라틴 전 스크립트 TTF (CJK 는 playwright deps 의
#   fonts-noto-cjk 로 기설치, 한글 TTF 는 fonts-nanum).
# - ttf-mscorefonts-installer(contrib, EULA preseed): 정식 Arial/Times New Roman 등 MS 코어 폰트 —
#   재배포 금지 라이선스라 빌드타임 다운로드 방식만 허용됨. metric-호환 Liberation Sans 는 기설치라
#   이 레이어가 실패해도 대체 가능.
RUN sed -i 's/Components: main/Components: main contrib/' /etc/apt/sources.list.d/debian.sources \
    && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
    && apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr-all fonts-noto-core ttf-mscorefonts-installer \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# 한국 공문서 툴킷(kordoc, npm) — HWP 3.x/5.x·HWPX·HWPML 파싱/생성/서식 채우기/신구대조.
# network=none 샌드박스라 런타임 `npx -y kordoc` 다운로드가 불가하므로 빌드타임에 전역 설치한다
# (python venv·opendataloader 와 같은 패턴). 순수 JS 파서라 한컴오피스·JVM 이 필요 없다.
# 버전은 apps/api 의존성(doc-extractor 가 쓰는 kordoc)과 메이저를 맞춘다.
RUN npm install -g --no-fund --no-audit kordoc@^4 \
    && npm cache clean --force \
    && kordoc --version

USER node
WORKDIR /workspace
