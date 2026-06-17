/**
 * ============================================================
 * Security Review System Prompt (P-2)
 * ============================================================
 *
 * 보안 리뷰 분석 모델에 전달되는 시스템 프롬프트. JSON 전용 출력 지시.
 * 카테고리 목록은 config 에서 주입(No-Hardcoding).
 *
 * @module prompts/security-review-system
 * @see services/security-review/analyzer.ts
 * @see config/security-review.ts
 */

import { VULN_CATEGORIES } from '../config/security-review';

/**
 * 보안 리뷰 시스템 프롬프트를 생성합니다.
 *
 * @param categories - 허용 카테고리(생략 시 전체)
 * @returns 시스템 프롬프트 문자열
 */
export function buildSecurityReviewSystemPrompt(categories: readonly string[] = VULN_CATEGORIES): string {
    const catList = categories.join(', ');
    return `당신은 시니어 애플리케이션 보안 검토자입니다. 제공된 코드에서 **실제로 악용 가능한 보안 취약점**만 찾습니다.

## 분류 카테고리 (category 필드는 반드시 이 중 하나)
${catList}

## 출력 규칙 (엄수)
- 오직 유효한 JSON 객체 하나만 출력합니다. 코드펜스/설명/머리말 금지.
- 스키마:
{
  "summary": "한 줄 요약(한국어)",
  "findings": [
    {
      "category": "위 목록 중 하나",
      "severity": "critical|high|medium|low",
      "line": 정수 또는 null,
      "title": "간결한 제목(한국어)",
      "description": "무엇이 왜 취약한지(한국어)",
      "exploit_scenario": "구체적 악용 시나리오(한국어)",
      "confidence": 1-10 정수
    }
  ]
}

## 판정 원칙
- 확실히 악용 가능한 것만. 추측성·이론적·저영향 항목은 제외합니다.
- 다음은 보고하지 마세요(노이즈): DoS/ReDoS, 로그 스푸핑, 메모리 누수, 단순 코드 스타일, 누락된 보안 헤더 권고.
- 확신이 약하면 confidence 를 낮게(≤5) 매깁니다. 취약점이 없으면 "findings": [] 로 둡니다.
- 절대 취약점을 지어내지 마세요. 코드에 근거가 없으면 보고하지 않습니다.`;
}

/**
 * 분석 대상 코드를 user 메시지로 포맷합니다.
 */
export function buildSecurityReviewUserMessage(code: string, language?: string, filename?: string): string {
    const meta = [filename ? `파일: ${filename}` : '', language ? `언어: ${language}` : '']
        .filter(Boolean)
        .join(' · ');
    const header = meta ? `${meta}\n` : '';
    return `${header}다음 코드를 검토하세요:\n\n\`\`\`\n${code}\n\`\`\``;
}
