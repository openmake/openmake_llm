/**
 * ============================================================
 * Report Guide — 보고서 파이프라인 데이터 계약 시스템 프롬프트
 * ============================================================
 *
 * P1 보고서 파이프라인 (2026-07-30): 사용자 메시지가 보고서 작성 의도
 * (REPORT_INTENT_PATTERNS)일 때만 주입. LLM 은 HTML/CSS 를 직접 쓰지 않고
 * ```reportdata 블록으로 데이터(JSON)만 생성한다 — 백엔드가 고정 디자인
 * 템플릿(config/report-templates.ts)으로 결정적 렌더 후 아티팩트로 발행.
 *
 * 예약 리포트(render_report.py + agent_task_schedules goal)와 동일한
 * "renderer owns design" 계약의 채팅 경로 버전.
 *
 * @module prompts/report-guide
 */
import { REPORT_TEMPLATES } from '../config/report-templates';

const DEFAULT_TEMPLATE_ID = 'generic-report';

/**
 * 보고서 데이터 계약 가이드 — intent 매칭 턴에만 주입 (토큰 낭비 방지).
 *
 * @param language - 사용자 resolvedLanguage ('ko' | 'en' | ...). 미지정 시 영어.
 * @param templateId - 사용할 템플릿 (기본 generic-report)
 */
export function getReportGuide(language?: string, templateId: string = DEFAULT_TEMPLATE_ID): string {
    const spec = REPORT_TEMPLATES[templateId];
    if (!spec) return '';
    return language === 'ko'
        ? `

---

## 📊 보고서 출력 형식 — **반드시 따라야 함**

사용자가 보고서를 요청했습니다. 이번 응답은 **반드시 \`\`\`reportdata JSON 코드 블록을
포함**해야 합니다 — 파일명·식별자·링크만 답하고 끝내는 것은 실패입니다.
HTML/CSS 를 직접 작성하지 마세요 — 디자인은 시스템의 고정 템플릿이 담당하고,
당신은 **데이터(JSON)만** 생성합니다. 절차:

1. 필요한 조사(웹 검색 등)를 먼저 수행합니다.
2. 답변 본문에는 짧은 안내(2~3문장)만 쓰고, 이어서 아래 계약의 JSON 을
   \`\`\`reportdata 코드 블록으로 정확히 1개 출력합니다.
3. 블록 뒤에 JSON 내용을 반복 설명하지 마세요.

\`\`\`reportdata 블록 계약 (템플릿: ${templateId}):
${spec.contract}

주의:
- JSON 은 유효해야 합니다(주석·후행 콤마 금지). 문자열 안의 줄바꿈은 \\n 으로.
- <artifact> 태그·HTML·마크다운 표를 직접 만들지 마세요 — 시스템이 이 블록을
  렌더해 아티팩트로 자동 발행합니다.`
        : `

---

## 📊 Report output format — **REQUIRED**

The user asked for a report. Your response MUST contain a \`\`\`reportdata JSON code
block — answering with only a filename, identifier, or link is a failure.
Do NOT write HTML/CSS yourself — a fixed design template owns the design; you produce
**data (JSON) only**. Procedure:

1. Do the research first (web search etc.).
2. In the reply body write only a brief note (2-3 sentences), then output exactly ONE
   \`\`\`reportdata code block with JSON matching the contract below.
3. Do not restate the JSON content after the block.

\`\`\`reportdata block contract (template: ${templateId}):
${spec.contract}

Notes:
- The JSON must be valid (no comments, no trailing commas). Escape newlines in strings as \\n.
- Do not emit <artifact> tags, raw HTML, or markdown tables as the deliverable — the system
  renders this block and publishes the artifact automatically.`;
}
