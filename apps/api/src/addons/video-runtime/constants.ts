/**
 * video-runtime 상수 (P10, 2026-09-23) — 종전 `config/capabilities.ts` 의 영상 전용 값을 소유 add-on 으로 옮겼다.
 * 비율 → 크기 표(`VIDEO_GEN_ASPECT_SIZES`)는 Base Planner 프롬프트도 쓰므로 config 에 남는다.
 * @module addons/video-runtime/constants
 */
import { VIDEO_GEN_ASPECT_SIZES } from '../../config/capabilities';

/**
 * 영상 후속 발화 판정 — Planner 가 저장·진행 중인 영상 job 첨부를 두고도 `simple` 로 답하면(실측: bai qwen3.8-flash 가
 * "완료·저장됨" 을 "할 일 없음" 으로 읽음, 2026-09-12) 결정적으로 job 재조회 1작업으로 보정한다. 사용자 발화에만 적용.
 */
export const VIDEO_JOB_FOLLOWUP_PATTERN = /영상|비디오|동영상|\bvideo\b|\bclip\b/i;
export const VIDEO_GEN_DEFAULT_SECONDS = '4';
/** 프롬프트에 덧붙일 참조(refs) 컨텍스트 최대 글자 수 */
export const VIDEO_REFS_MAX_CHARS = 600;
/**
 * 비율을 말하지 않은 요청의 기본은 가로 — hasa 영상 모델의 규격이 가로다(LTX-2 1280x704, wan2.2-i2v 832x480 —
 * 공개 카탈로그 `video_spec.sizes`, 2026-09-22). 종전 세로 기본값은 바닷가 장면도 세로로 만들었다.
 */
export const VIDEO_GEN_DEFAULT_SIZE = '1280x720';
export const VIDEO_ASPECT_PATTERNS: ReadonlyArray<readonly [keyof typeof VIDEO_GEN_ASPECT_SIZES, RegExp]> = [
    ['portrait', /세로|쇼츠|숏츠|릴스|9\s*:\s*16|\bportrait\b|\bvertical\b|\bshorts\b|\breels\b/i],
    ['square', /정사각|1\s*:\s*1|\bsquare\b/i],
    ['landscape', /가로|16\s*:\s*9|\blandscape\b|\bhorizontal\b|\bwidescreen\b/i],
];
/**
 * 영상 모델이 스스로 넣는 가짜 자막·워터마크 억제 — negative_prompt 를 받는 provider 에만 싣는다(어댑터 `negativePrompt`).
 * 'text' 는 넣지 않는다: 제목 글자를 요청한 영상까지 막는다. 글자를 빼 달라는 요청은 Planner 가 계획의 negative_prompt 로 더한다.
 * 보조 방어다 — 깨진 자막의 주 원인은 프롬프트의 부정 표현(VIDEO_PROMPT_NEGATION_PATTERN). hasa 플레이그라운드도 기본값을 싣는다.
 */
export const VIDEO_GEN_DEFAULT_NEGATIVE_PROMPT = 'subtitles, captions, watermark';
/** 영상 프롬프트에서 "빼 달라" 는 대상이 되는 화면 요소 */
export const VIDEO_NEGATABLE_TERM_PATTERN = /\b(?:text|subtitles?|captions?|words?|letters?|logos?|watermarks?|titles?|typography)\b/gi;
const VIDEO_NEGATABLE = String.raw`(?:on[- ]?screen\s+)?(?:text|subtitles?|captions?|words?|letters?|logos?|watermarks?|titles?|typography)`;
/**
 * 영상 프롬프트의 부정 표현("no text on screen", "without subtitles or logos") — negative_prompt 를 받는 provider 면 실행기가
 * 프롬프트에서 걷어내 negative_prompt 로 옮긴다. Planner 에 쓰지 말라고 해도 8회 중 5회 적었다.
 * 실측(2026-09-22, hasa LTX-2 4초·같은 장면): "no text on screen" 이 든 프롬프트는 깨진 자막 3/4(negative_prompt 유무 무관),
 * 뺀 프롬프트는 0/4(negative_prompt 유무 무관) — 부정어가 오히려 글자를 불러온다.
 */
export const VIDEO_PROMPT_NEGATION_PATTERN = new RegExp(
    String.raw`[,;]?\s*\b(?:with\s+)?(?:no|without)\s+(?:any\s+)?(${VIDEO_NEGATABLE}(?:\s*(?:,|\bor\b|\band\b)\s*${VIDEO_NEGATABLE})*)(?:\s+(?:on[- ]?screen|overlays?|visible))?`,
    'gi',
);
