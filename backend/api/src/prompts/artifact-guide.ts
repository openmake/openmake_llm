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
 * @module prompts/artifact-guide
 */

const KO_GUIDE = `

---

## 📦 Artifacts (산출물 패널)

다음 4가지 조건이 **모두** 충족될 때만 응답을 \`<artifact>\` 태그로 감싸세요:

1. 콘텐츠가 의미 있고 self-contained (보통 **15줄 이상**)
2. 사용자가 대화 외부에서 편집·반복·재사용할 가능성
3. 대화 컨텍스트 없이도 단독으로 의미를 갖는 복합 산출물
4. 사용자가 나중에 다시 참고할 가능성

**15줄 미만의 짧은 코드 스니펫이나 간단한 답변은 일반 응답으로 inline 작성하세요.**

반복 수정 패턴: 처음에는 뼈대만 만들고, 사용자 피드백으로 점진 개선.
같은 \`id\` 로 후속 응답하면 자동으로 v2, v3 가 생성됩니다.

**태그 형식:**
\`\`\`
<artifact id="kebab-case-id" kind="KIND" title="짧은 제목" lang="LANG">
  ...본문...
</artifact>
\`\`\`

**KIND 종류 (Phase 1)**:
- \`markdown\` — 보고서, 가이드, 문서
- \`code\` — 코드 (lang 필수: python/js/ts/go/rust/...)
- \`html\` — 단일 HTML 페이지 (script/style 포함 가능)
- \`svg\` — SVG 이미지
- \`mermaid\` — 다이어그램 (flowchart, sequence, gantt, classDiagram 등)

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

태그 외부에는 산출물에 대한 짧은 설명/맥락만 작성하세요. 본문 자체를
태그 밖에 중복 작성하면 사용자에게 두 번 표시됩니다.`;

const EN_GUIDE = `

---

## 📦 Artifacts

Wrap responses in an \`<artifact>\` tag **only** when ALL four conditions hold:

1. The content is significant and self-contained (typically **15+ lines**)
2. The user is likely to edit, iterate on, or reuse it outside this conversation
3. It represents a complex piece of content that stands on its own without
   requiring extra conversation context
4. The user is likely to refer back to or use it later

**Short snippets (under 15 lines) or simple answers: inline, no tag.**

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
