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
