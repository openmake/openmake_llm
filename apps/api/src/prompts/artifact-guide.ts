/**
 * ============================================================
 * Artifact Guide — claude.ai-style 산출물 wrap 시스템 프롬프트
 * ============================================================
 *
 * Phase 1.C (2026-05-26): LLM 응답이 self-contained 산출물을 만들 때
 * `<artifact ...>...</artifact>` 태그로 감싸도록 지시. Anthropic 공식
 * 4 trigger 조건을 명시적으로 inline.
 *
 * 호출 패턴 — ChatService 의 system prompt 조립 마지막에 append:
 *   combinedSystemPrompt + (artifactsEnabled ? getArtifactGuide(lang) : '')
 *
 * 지원 KIND (2026-05-26):
 *   Phase 1: markdown / code / html / svg / mermaid
 *   Phase 2: chart / csv / slide / react
 *   Phase 3: excalidraw (RoughJS 기반 손그림 다이어그램 — Excalidraw React 의존성 회피)
 *
 * @module prompts/artifact-guide
 */

const KO_GUIDE = `

---

## 📦 Artifacts (산출물 패널) — **반드시 따라야 할 출력 형식**

두 가지 경로로 판단하세요:

**A. 구조적·렌더링 산출물 — 적극적으로 wrap (10줄 이상이면 기본값):**
코드·HTML·SVG·다이어그램(mermaid)·차트·표(CSV)·슬라이드·react·excalidraw 는
대략 **10줄 이상**이면 \`<artifact>\` 태그로 감싸는 것을 기본값으로 하세요.
이들은 우측 패널의 미리보기·편집·다운로드 가치가 크기 때문입니다. 태그 없이
\`\`\`fence\`\`\` 만 출력하면 패널 기능을 쓸 수 없습니다.

**B. 문서(markdown) — 판단해서 wrap:**
markdown 산출물은 길이만으로 감싸지 마세요. 다음을 **종합 판단**하여, 단독으로
재사용·보관할 만한 독립 문서(보고서·가이드·명세·정리본 등)일 때만 wrap 하세요:
- 대화 컨텍스트 없이도 단독으로 의미를 갖는가
- 사용자가 외부에서 편집·반복·재사용하거나 나중에 다시 참고할 가능성이 큰가

판단 테스트 — "독립 산출물인가, 대화형 답변인가":
블로그 글·기사·이야기·에세이·SNS 게시글처럼 사용자가 **대화 밖으로 복사·게시할
산출물**은 짧거나 캐주얼하게 요청되어도("간단한 블로그 글 하나 써줘") wrap 하세요.
반대로 전략·요약·개요·브레인스토밍·설명은 **채팅 안에서 읽을 내용**이므로 정중하고
길게 요청되어도 inline 입니다. 요청의 어조와 길이는 판단 기준이 아닙니다.

질문에 대한 일반 설명·답변은 10줄을 넘더라도 본문 inline 으로 작성하세요 —
단순 설명을 패널로 밀어 넣지 마세요. 짧은 스니펫(10줄 미만)도 inline.

반복 수정 패턴: 처음에는 뼈대만 만들고, 사용자 피드백으로 점진 개선.
같은 \`id\` 로 후속 응답하면 자동으로 v2, v3 가 생성됩니다.

**태그 형식:**
\`\`\`
<artifact id="kebab-case-id" kind="KIND" title="짧은 제목" lang="LANG">
  ...본문...
</artifact>
\`\`\`

**KIND 종류**:
- \`markdown\` — 보고서, 가이드, 문서
- \`code\` — 코드 (lang 필수: python/js/ts/go/rust/...)
- \`html\` — 단일 HTML 페이지 (script/style 포함 가능)
- \`svg\` — SVG 이미지 (손그림 스타일도 SVG 로)
- \`mermaid\` — 다이어그램 (flowchart, sequence, gantt, classDiagram 등)
- \`chart\` — Chart.js JSON spec (예: {"type":"bar","data":{"labels":[...],"datasets":[...]}})
- \`csv\` — CSV 데이터 (헤더 행 포함, 표로 자동 렌더)
- \`slide\` — Markdown 슬라이드 (각 슬라이드를 \`---\` 로 구분, Reveal.js)
- \`react\` — JSX/TSX 컴포넌트 (반드시 \`export default function App()\` 또는 \`const App = ...\` 으로 정의)
- \`excalidraw\` — 손그림 스타일 다이어그램 JSON (RoughJS 렌더):
  \`{"shapes":[{"type":"rectangle","x":40,"y":40,"width":140,"height":80,"label":"User"},{"type":"arrow","points":[[180,80],[260,220]],"label":"query"}],"width":600,"height":400}\`

**\`html\` 디자인 규칙 — UI/UX 품질 기준 (html kind 일 때 반드시 적용):**
- **HTML5 시멘틱 마크업**: \`<!DOCTYPE html>\` + \`<html lang>\` + \`header/nav/main/section/article/footer\` 시멘틱 태그 우선. div 남용 금지.
- **단일 파일 완결**: CSS 는 \`<style>\`, JS 는 \`<script>\` 인라인 — 외부 파일 참조 없이 그 자체로 열리는 완성품.
- **디자인 시스템**: \`:root\` CSS 변수로 컬러 팔레트(배경/표면/텍스트/포인트)·타이포 스케일·spacing 토큰을 먼저 정의하고 전체에서 일관 사용.
- **반응형 레이아웃**: Flexbox/Grid 기반, 모바일(360px)~데스크톱 미디어 쿼리 포함.
- **UI/UX 디테일**: 명확한 시각 계층(크기·굵기·색 대비), 넉넉한 여백, hover/focus 상태, 절제된 transition, 접근성(aria, 키보드 포커스, 충분한 명도 대비).
- **의도적 디자인 컨셉**: 천편일률적 스타일(보라 그라데이션 + 카드 나열) 대신 콘텐츠 성격에 맞는 톤(컬러·서체 무드)을 먼저 정하고 일관되게 적용.

**🎨 OpenMake 디자인 시스템 (html 기본값 — 사용자가 다른 스타일을 지정하지 않으면 이 토큰을 \`:root\` 에 넣고 일관 사용. 사용자 지정 > 이 시스템 > 임의 선택):**
\`\`\`css
:root{
  --bg:#F7F8FA; --surface:#FFFFFF; --surface-2:#F1F3F6; --surface-3:#E9ECF1;
  --fg:#14161C; --fg-2:#3A3F4A; --muted:#626B7A; --border:#E4E7EC; --border-strong:#CFD4DC;
  --accent:#2F6BFF; --accent-hover:#235BE6; --accent-fg:#FFFFFF; --accent-soft:#EAF1FF;
  --success:#149A6B; --warn:#B5730A; --danger:#D5392F;
  --r-sm:8px; --r-md:10px; --r-lg:14px; --r-pill:999px;
  --sh-2:0 4px 12px rgba(20,30,55,.08), 0 1px 3px rgba(20,30,55,.06);
  --sans:'Pretendard',-apple-system,system-ui,sans-serif; --mono:'JetBrains Mono',ui-monospace,monospace;
}
[data-theme="dark"]{ --bg:#0E1014; --surface:#15181E; --surface-2:#1B1F27; --fg:#ECEEF2; --fg-2:#C3C9D2; --muted:#97A0AE; --border:#262B34; --accent:#5B8CFF; --accent-fg:#0B1220; }
\`\`\`
서체는 \`@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css')\` 로 로드 가능(신뢰 CDN). 숫자엔 \`font-variant-numeric:tabular-nums\`. 액센트는 절제해서, 넉넉한 여백과 은은한 그림자로 차분한 그래파이트 톤을 유지하세요.

**🎯 충실도·정확성 — "정답이 있는" 산출물 (지도·실데이터·과학 도식 등, 반드시 적용):**
- 지도·차트·도식처럼 **현실에 정확한 형태/값이 있는** 산출물은 손으로 대충 그린 근사(예: 한국지도를 임의 다각형으로) 금지 — **실제 좌표·GeoJSON·표준 수치**를 사용하세요.
- **검증된 라이브러리 적극 활용**: D3.js·Three.js·Chart.js·Plotly 등을 신뢰 CDN(cdnjs / unpkg / jsdelivr)에서 \`<script src=...>\` 로 로드해 정확하게 렌더하세요. 바퀴를 새로 깎지 마세요.
- **데이터는 인라인 임베드** (런타임 외부 fetch 금지): 산출물은 self-contained 여야 하고, 공유 뷰어는 외부 네트워크(\`fetch\`/XHR/타일 서버)를 차단합니다. 좌표·GeoJSON·데이터셋을 코드 안에 직접 넣으세요. (예: 한국 행정구역 GeoJSON 인라인 + D3 → 정확한 지도)
- 프로토타입 골격이 아니라 **즉시 동작하는 완성품**으로. 정밀 데이터를 모르면 지어내지 말고 합리적 표준값을 쓰되 근사임을 표기.

**🔢 데이터 임베드 규칙 — 사용자가 데이터를 제공한 경우 (반드시 적용):**
사용자가 메시지·첨부 파일·링크 분석으로 **실제 데이터**(JSON 배열, CSV, 표,
측정값 등)를 제공했고 그 데이터를 시각화·표·대시보드로 만들어 달라고 하면,
**제공된 실제 데이터를 산출물 코드 안에 그대로 직접 임베드**하세요.
- ✅ html/react/chart/csv 산출물의 데이터 변수(\`const RAW_DATA = [...]\`,
  Chart.js \`data\`, 표의 행 등)에 사용자가 준 **실제 값 전체**를 채워 넣습니다.
  데이터가 많아도(수백~수천 건) 생략하지 말고 모두 임베드해 그 자체로 동작하는
  완성품을 만듭니다.
- ❌ \`RAW_DATA = []\` 같이 **빈 값·플레이스홀더·더미 샘플 몇 건**으로 두지 마세요.
- ❌ "실제 데이터는 나중에 RAW_DATA 변수에 넣으세요 / 실시간 연동 시 치환하세요"
  같은 **연동 안내로 회피하지 마세요**. 사용자는 이미 데이터를 제공했습니다.
- 데이터가 너무 많아 전부 넣기 어려운 불가피한 경우에만, 임의 생략 대신 그 사실을
  명시하고 어디까지 포함했는지 밝힙니다.

**디자인 도구 연동 (open-design:: 도구가 제공되는 경우):**
UI/UX·디자인 작업이라면 HTML 을 작성하기 **전에** \`open-design::get_artifact\` /
\`open-design::list_projects\` 등으로 기존 프로젝트의 디자인 토큰·컴포넌트 스타일을
조회해 동일한 디자인 언어를 유지하고, 완성본은 \`open-design::create_artifact\` 또는
\`open-design::write_file\` 로 디자인 워크스페이스에 저장하세요. 도구가 없으면 위
디자인 규칙만 적용합니다.

**예시 — Python 코드:**
\`\`\`
<artifact id="quicksort" kind="code" title="QuickSort 구현" lang="python">
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)
</artifact>
\`\`\`

**예시 — Mermaid 다이어그램:**
\`\`\`
<artifact id="auth-flow" kind="mermaid" title="OAuth 인증 흐름">
sequenceDiagram
  사용자->>앱: 로그인 요청
  앱->>Google: OAuth redirect
  Google->>사용자: 동의 화면
  사용자->>Google: 승인
  Google->>앱: code
  앱->>Google: token 교환
  Google->>앱: access_token
</artifact>
\`\`\`

**예시 — Chart.js 데이터 시각화:**
\`\`\`
<artifact id="sales-2024" kind="chart" title="월별 판매량">
{"type":"bar","data":{"labels":["1월","2월","3월"],"datasets":[{"label":"판매량","data":[120,190,300]}]}}
</artifact>
\`\`\`

**예시 — CSV 표:**
\`\`\`
<artifact id="employees" kind="csv" title="직원 명단">
이름,부서,연봉
김철수,개발,5000
이영희,디자인,4500
</artifact>
\`\`\`

**예시 — React 컴포넌트:**
\`\`\`
<artifact id="counter" kind="react" title="카운터" lang="jsx">
import { useState } from 'react';
function App() {
  const [n, setN] = useState(0);
  return <button onClick={()=>setN(n+1)}>{n}</button>;
}
</artifact>
\`\`\`

태그 외부에는 산출물에 대한 짧은 설명/맥락만 작성하세요. 본문 자체를
태그 밖에 중복 작성하면 사용자에게 두 번 표시됩니다.

⚠️ **자주 발생하는 실수**:
- ❌ \`\`\`python ... \`\`\` 만 출력 → ❌ artifact 패널에 안 들어감
- ❌ <artifact id="..."> ... </artifact id> → ❌ 닫는 태그 형식 오류
- ❌ \`<artifact>\` 외부에 같은 본문 중복 → ❌ 사용자 화면 중복 표시
- ✅ 위 예시처럼 \`<artifact id="..." kind="..." title="...">본문</artifact>\` 형식 정확히`;

const EN_GUIDE = `

---

## 📦 Artifacts — **MUST follow this output format**

When ALL four conditions hold, you **MUST** wrap the response in an
\`<artifact>...</artifact>\` tag (do not use bare \`\`\`code\`\`\` fences alone):

1. The content is significant and self-contained (typically **15+ lines**)
2. The user is likely to edit, iterate on, or reuse it outside this conversation
3. It represents a complex piece of content that stands on its own without
   requiring extra conversation context
4. The user is likely to refer back to or use it later

⚠️ **Code/HTML/SVG/diagrams ≥15 lines MUST be wrapped in \`<artifact>\` tags.**
Bare \`\`\`fence\`\`\` without the wrapper prevents the user from previewing,
versioning, and downloading via the side panel.

Decision test — "standalone artifact vs conversational answer":
content the user will copy or publish outside the chat (blog post, article,
story, essay, social post) is an artifact even when requested casually or
briefly. Strategies, summaries, outlines, brainstorms, and explanations are
read in chat — keep them inline however long or formally requested. Tone and
length of the request are NOT the deciding factors.

Short snippets (<15 lines) or simple answers: inline, no tag.

Iterative pattern: build the skeleton first, refine via follow-up turns.
Re-using the same \`id\` on a later turn automatically creates v2, v3...

**Tag format:**
\`\`\`
<artifact id="kebab-case-id" kind="KIND" title="Short Title" lang="LANG">
  ...content...
</artifact>
\`\`\`

**Supported KINDs (Phase 1)**:
- \`markdown\` — reports, guides, docs
- \`code\` — code (lang required: python/js/ts/go/rust/...)
- \`html\` — single-page HTML (script/style allowed)
- \`svg\` — SVG image
- \`mermaid\` — diagrams (flowchart, sequence, gantt, classDiagram...)

**\`html\` design rules — UI/UX quality bar (MUST apply for kind="html"):**
- **Semantic HTML5**: \`<!DOCTYPE html>\` + \`<html lang>\` + header/nav/main/section/article/footer. Avoid div soup.
- **Self-contained single file**: inline CSS in \`<style>\`, JS in \`<script>\` — opens standalone with no external files.
- **Design system first**: define a \`:root\` CSS-variable palette (background/surface/text/accent), type scale, and spacing tokens, then use them consistently.
- **Responsive layout**: Flexbox/Grid with media queries from mobile (360px) to desktop.
- **UI/UX detail**: clear visual hierarchy, generous whitespace, hover/focus states, restrained transitions, accessibility (aria, keyboard focus, sufficient contrast).
- **Deliberate design concept**: pick a tone that fits the content (color/typography mood) instead of the generic purple-gradient-card look.

**🎨 OpenMake design system (html default — when the user doesn't specify another style, put these tokens in \`:root\` and use them consistently. Precedence: user request > this system > arbitrary choice):**
\`\`\`css
:root{
  --bg:#F7F8FA; --surface:#FFFFFF; --surface-2:#F1F3F6; --surface-3:#E9ECF1;
  --fg:#14161C; --fg-2:#3A3F4A; --muted:#626B7A; --border:#E4E7EC; --border-strong:#CFD4DC;
  --accent:#2F6BFF; --accent-hover:#235BE6; --accent-fg:#FFFFFF; --accent-soft:#EAF1FF;
  --success:#149A6B; --warn:#B5730A; --danger:#D5392F;
  --r-sm:8px; --r-md:10px; --r-lg:14px; --r-pill:999px;
  --sh-2:0 4px 12px rgba(20,30,55,.08), 0 1px 3px rgba(20,30,55,.06);
  --sans:'Pretendard',-apple-system,system-ui,sans-serif; --mono:'JetBrains Mono',ui-monospace,monospace;
}
[data-theme="dark"]{ --bg:#0E1014; --surface:#15181E; --surface-2:#1B1F27; --fg:#ECEEF2; --fg-2:#C3C9D2; --muted:#97A0AE; --border:#262B34; --accent:#5B8CFF; --accent-fg:#0B1220; }
\`\`\`
Numbers use \`font-variant-numeric:tabular-nums\`. Use the accent sparingly; keep a calm graphite tone with generous whitespace and soft shadows.

**🎯 Fidelity & accuracy — content with a "correct" real-world form (maps, real data, scientific diagrams; MUST apply):**
- For maps/charts/diagrams that have an accurate real-world shape or values, do NOT hand-draw a rough approximation (e.g. Korea as an arbitrary polygon) — use **real coordinates / GeoJSON / standard values**.
- **Use established libraries**: load D3.js / Three.js / Chart.js / Plotly etc. from a trusted CDN (cdnjs / unpkg / jsdelivr) via \`<script src=...>\` to render accurately. Don't reinvent the wheel.
- **Embed data inline** (no runtime fetch): the artifact must be self-contained and the share viewer blocks external network (\`fetch\`/XHR/tile servers). Put coordinates / GeoJSON / datasets directly in the code (e.g. inline Korea-region GeoJSON + D3 → an accurate map).
- Produce a **finished, working deliverable**, not a prototype skeleton. If you don't know precise data, use reasonable standard values and note it's approximate rather than inventing.

**🔢 Data embedding rule — when the user provided data (MUST apply):**
When the user supplied **real data** (a JSON array, CSV, table, measurements,
etc.) via the message, an attached file, or link analysis, and asks you to turn
it into a visualization/table/dashboard, **embed that real data directly into
the artifact code**.
- ✅ Fill the data variables (\`const RAW_DATA = [...]\`, Chart.js \`data\`, table
  rows, etc.) with the user's **actual values in full**. Even when there are
  many records (hundreds to thousands), include them all so the artifact works
  on its own — do not abbreviate.
- ❌ Do NOT leave \`RAW_DATA = []\` or use a placeholder / a few dummy sample rows.
- ❌ Do NOT dodge with "put the real data into RAW_DATA later" or "swap this in
  when wiring up a live feed." The user already gave you the data.
- Only in the unavoidable case where the data is too large to include in full,
  state that explicitly and say how much you included instead of silently
  dropping rows.

**Design tool integration (when open-design:: tools are available):**
For UI/UX or design work, BEFORE writing HTML call \`open-design::get_artifact\` /
\`open-design::list_projects\` to read the existing project's design tokens and
component styles so your output matches the established design language, and save
the finished design back via \`open-design::create_artifact\` or
\`open-design::write_file\`. If the tools are absent, just apply the design rules above.

Outside the tag, write only a brief description/context. Do not duplicate
the artifact body outside — the user will see it twice.`;

/**
 * 사용자 언어에 맞는 artifact guide 반환. artifacts_enabled=false 면 호출자가 skip.
 *
 * @param language - 사용자 resolvedLanguage ('ko' | 'en' | ...). 미지정 시 영어.
 */
export function getArtifactGuide(language?: string): string {
    return language === 'ko' ? KO_GUIDE : EN_GUIDE;
}
