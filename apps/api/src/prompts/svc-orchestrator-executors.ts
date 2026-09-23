/**
 * ============================================================
 * Orchestrator Executor Prompts — 하위 작업자 system prompt
 * ============================================================
 *
 * 멀티모달 오케스트레이터의 capability 실행기(services/orchestrator/executors/*)가
 * 배정 모델에 싣는 system prompt·기본 지시문. 응답 언어별(ko/en)로 분리한다 —
 * 영어 턴에 한국어 머리글이 섞이면 결과가 한국어로 뒤집혀 하류(image.generate refs 등)를
 * 오염시킨다(English UI Korean leak, 2026-09-14).
 *
 * @module prompts/svc-orchestrator-executors
 */

/** text.reason / text.code 하위 작업자 system prompt */
const TEXT_WORKER_KO =
    '당신은 오케스트레이터의 하위 작업자입니다. 주어진 지시만 수행하고 결과를 간결한 텍스트로 돌려주세요. 인사·서두 없이 본문만.';
const TEXT_WORKER_EN =
    'You are a sub-task worker of an orchestrator. Do only what the instruction says and return a concise plain-text result without preamble.';

export function getTextWorkerSystemPrompt(lang: string): string {
    return lang === 'ko' ? TEXT_WORKER_KO : TEXT_WORKER_EN;
}

/** vision.ocr 전사 system prompt */
const OCR_KO =
    '당신은 OCR 기록자입니다. 이미지 속 글자·표·코드를 보이는 그대로, 순서대로, 빠짐없이 전사하세요. 해석·요약 금지. 표는 마크다운 표로.';
const OCR_EN =
    'You are an OCR transcriber. Transcribe all text, tables, and code exactly as shown, in order, without interpretation. Render tables as markdown.';

export function getOcrSystemPrompt(lang: string): string {
    return lang === 'ko' ? OCR_KO : OCR_EN;
}

/** vision.describe 기본 사용자 지시(첨부만 있고 명시 instruction 이 없을 때) */
const DESCRIBE_DEFAULT_KO = '첨부 이미지를 서술하세요.';
const DESCRIBE_DEFAULT_EN = 'Describe the attached image.';

export function getVisionDescribeDefaultInstruction(lang: string): string {
    return lang === 'ko' ? DESCRIBE_DEFAULT_KO : DESCRIBE_DEFAULT_EN;
}
