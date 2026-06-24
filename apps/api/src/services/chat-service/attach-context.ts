/**
 * 첨부 파일 · URL 사전 분석 컨텍스트 빌더 (2026-06-13 sockets/ws-chat-handler 에서 이동)
 *
 * 사용자 메시지의 첨부 파일 내용과 본문 내 URL 스크랩 결과를
 * LLM 주입용 컨텍스트 문자열(fileContext 채널)로 조립한다.
 * 전송 계층(WS/REST)과 무관한 비즈니스 로직 — 양쪽 어디서든 호출 가능.
 *
 * 멀티턴 유지: 컨텍스트는 DB 미저장(transient)이므로, 세션 단위 메모리 캐시로
 * 후속 턴에 재주입해 "그럼 3번 항목은?" 류 후속 질문의 근거 소실을 방지한다.
 *
 * @module services/chat-service/attach-context
 */
import LRUCache = require('lru-cache');
import { createLogger } from '../../utils/logger';
import { FILE_ATTACH_LIMITS, URL_ANALYZE_LIMITS, ATTACH_CACHE_LIMITS, SCRAPE_ABORT_BUFFER_MS } from '../../config/runtime-limits';

const logger = createLogger('AttachContext');

/** 첨부 파일 입력 (WS payload files[] 항목과 구조 호환) */
export interface AttachedFileInput {
    id?: string;
    name: string;
    type?: string;
    /** 텍스트 파일 내용 (바이너리는 미전송). 빈 문자열은 빈 파일로 취급 */
    content?: string;
    /** 추출 대상 바이너리 문서의 base64 원본. doc-extractor 가 content 로 추출 후 제거 */
    data?: string;
    size?: number;
    /** 클라이언트가 전송 전 캡으로 내용을 절단했음 (절단 안내문 부착용) */
    truncated?: boolean;
}

/**
 * 메시지 본문에서 http(s) URL 을 추출하는 패턴.
 * 공백/꺾쇠/따옴표/대괄호 전까지를 URL 로 간주한다.
 * 닫는 괄호 ')' 는 URL 문자로 허용 — 위키피디아류 "..._(city)" 보존,
 * 마크다운 [텍스트](URL) 의 닫는 괄호는 trimUrlEnd 가 짝 검사로 제거.
 */
const MESSAGE_URL_PATTERN = /https?:\/\/[^\s<>"'\]]+/g;

/** URL 끝에 붙은 문장부호 제거 (예: "...com." / "...com,") */
const URL_TRAILING_PUNCT_PATTERN = /[.,;:!?]+$/;

/** 추출된 URL 끝의 문장부호와 짝이 맞지 않는 닫는 괄호를 제거한다. */
function trimUrlEnd(raw: string): string {
    let url = raw.replace(URL_TRAILING_PUNCT_PATTERN, '');
    // 괄호 짝 검사: 닫는 괄호가 여는 괄호보다 많을 때만 끝 ')' 제거 (균형 괄호는 URL 일부)
    while (url.endsWith(')') &&
        (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
        url = url.slice(0, -1).replace(URL_TRAILING_PUNCT_PATTERN, '');
    }
    return url;
}

/**
 * 본문 내 최장 백틱 런보다 긴 fence 를 생성한다.
 * 첨부 내용에 ``` 가 포함돼도 fence 가 조기 종료되지 않도록 보장 (프롬프트 구조 보호).
 */
function fenceFor(body: string): string {
    let maxRun = 0;
    for (const run of body.match(/`+/g) || []) maxRun = Math.max(maxRun, run.length);
    return '`'.repeat(Math.max(3, maxRun + 1));
}

/** cap 초과 시 절단 — 절단 여부와 함께 반환 (안내문 부착은 호출자가 라벨 결정) */
function capText(text: string, cap: number): { body: string; truncated: boolean } {
    const truncated = text.length > cap;
    return { body: truncated ? text.slice(0, cap) : text, truncated };
}

/**
 * 첨부 파일 목록 → LLM 주입용 fileContext 문자열 구성.
 * 텍스트 파일(content 있음)은 내용을 fenced block 으로, 바이너리는 메타만 기재.
 * FILE_ATTACH_LIMITS 캡 적용 (개수/파일당 글자/합산 글자).
 */
export function buildFileContext(files: AttachedFileInput[] | undefined): string {
    if (!Array.isArray(files) || files.length === 0) return '';

    const limited = files.slice(0, FILE_ATTACH_LIMITS.MAX_FILES);
    const parts: string[] = [];
    let totalChars = 0;

    for (const f of limited) {
        if (!f || typeof f.name !== 'string') continue;
        const name = f.name.slice(0, FILE_ATTACH_LIMITS.MAX_NAME_LENGTH);
        const type = typeof f.type === 'string' ? f.type : 'unknown';

        if (typeof f.content === 'string') {
            if (f.content.length === 0) {
                // 빈 텍스트 파일 — 바이너리와 구분해 기재 (읽기 실패가 아님)
                parts.push(`### ${name} (${type})\n(빈 텍스트 파일 — 내용 없음)`);
                continue;
            }
            const remaining = FILE_ATTACH_LIMITS.MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) {
                parts.push(`### ${name} (${type})\n(전체 첨부 용량 한도 초과로 내용 생략)`);
                continue;
            }
            const cap = Math.min(FILE_ATTACH_LIMITS.MAX_CHARS_PER_FILE, remaining);
            const { body, truncated: serverTruncated } = capText(f.content, cap);
            // 클라이언트가 전송 전에 이미 절단한 경우(truncated 플래그) 서버 캡 미만이어도 안내 부착
            const truncated = f.truncated === true || serverTruncated;
            totalChars += body.length;
            const fence = fenceFor(body);
            parts.push(
                `### ${name} (${type})\n${fence}\n${body}\n${fence}` +
                (truncated ? `\n(파일이 길어 앞 ${body.length.toLocaleString()}자만 포함됨)` : '')
            );
        } else {
            // 바이너리 또는 내용 미전송 — 메타만 전달
            const sizeLabel = typeof f.size === 'number' ? `, ${(f.size / 1024).toFixed(1)}KB` : '';
            parts.push(`### ${name} (${type}${sizeLabel})\n(바이너리 파일 — 내용을 읽을 수 없어 파일명/형식만 제공됨)`);
        }
    }

    if (parts.length === 0) return '';
    const skipped = files.length - limited.length;
    return `\n\n## 📎 첨부 파일\n사용자가 첨부한 파일입니다. 답변 시 아래 내용을 참고하세요.\n\n${parts.join('\n\n')}` +
        (skipped > 0 ? `\n\n(첨부 ${files.length}개 중 ${FILE_ATTACH_LIMITS.MAX_FILES}개만 포함 — ${skipped}개 생략)` : '') + '\n';
}

/**
 * 메시지 내 URL 을 감지해 본문을 스크랩 → LLM 주입용 컨텍스트 구성.
 * - 현재 턴 메시지만 대상 (히스토리 재스크랩 방지 — 이전 턴 분은 세션 캐시가 담당)
 * - URL_ANALYZE_LIMITS 캡: 개수 / URL당 글자 / URL당 타임아웃
 * - SSRF 방어는 scrapePage 내부 validateOutboundUrl/safeFetch 가 담당
 * - 실패 시 "접근 불가 — 추측 금지" 안내만 주입 (모델 tool loop 의 web_scrape 재시도 여지)
 *
 * @param message - 사용자 메시지
 * @returns 주입용 컨텍스트 문자열 (URL 없거나 비활성 시 '')
 */
export async function buildUrlContext(message: string): Promise<string> {
    if (!URL_ANALYZE_LIMITS.ENABLED || !message) return '';

    const matched = message.match(MESSAGE_URL_PATTERN);
    if (!matched || matched.length === 0) return '';

    // dedup + 끝 문장부호/짝 안 맞는 괄호 제거 + 개수 캡
    const urls = [...new Set(matched.map(trimUrlEnd))]
        .slice(0, URL_ANALYZE_LIMITS.MAX_URLS);

    const { scrapePage } = await import('../../utils/web-scraper');

    const results = await Promise.all(urls.map(async (url) => {
        // deep-research content-scraper.ts 와 동일한 signal + 백스톱 타이머 패턴.
        // scrapePage 의 timeoutMs 는 stage(정적 fetch → Playwright 폴백)별 예산이므로
        // 절반씩 배분해 URL당 총 대기를 TIMEOUT_MS 수준으로 묶는다.
        // (Promise.race 금지 — 결과를 버리는 고아 스크랩/미해제 타이머 발생)
        const controller = new AbortController();
        const timeoutHandle = setTimeout(
            () => controller.abort(),
            URL_ANALYZE_LIMITS.TIMEOUT_MS + SCRAPE_ABORT_BUFFER_MS,
        );
        try {
            const scraped = await scrapePage(url, {
                timeoutMs: Math.floor(URL_ANALYZE_LIMITS.TIMEOUT_MS / 2),
                signal: controller.signal,
            });
            const { body, truncated } = capText(scraped.markdown, URL_ANALYZE_LIMITS.MAX_CHARS_PER_URL);
            return `### ${url}\n제목: ${scraped.title || '(없음)'}\n\n${body}` +
                (truncated ? `\n(본문이 길어 앞 ${URL_ANALYZE_LIMITS.MAX_CHARS_PER_URL.toLocaleString()}자만 포함됨)` : '');
        } catch (e) {
            logger.warn(`[Chat] URL 분석 실패 (${url}): ${e instanceof Error ? e.message : e}`);
            return `### ${url}\n(이 페이지는 가져오지 못했습니다 — 내용을 추측하지 말고, 필요 시 web_scrape 도구로 재시도하거나 접근 불가를 안내하세요)`;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }));

    return `\n\n## 🔗 링크 분석\n사용자 메시지에 포함된 URL 의 실제 본문입니다. 답변 시 아래 내용을 근거로 사용하세요.\n\n${results.join('\n\n')}\n`;
}

// ============================================
// 세션 단위 첨부 컨텍스트 캐시 (멀티턴 재주입)
// ============================================
// fileContext 는 transient(DB 미저장)라 다음 턴 히스토리에 남지 않는다.
// 세션별로 최근 컨텍스트 블록을 메모리에 보관해 후속 턴에 재주입한다.
// - saveHistory=false 요청은 호출자가 저장을 건너뛴다 (프라이버시 존중)
// - TTL/세션 수/글자 수 캡은 ATTACH_CACHE_LIMITS (env 오버라이드 가능)

const attachContextCache = new LRUCache<string, string[]>({
    max: ATTACH_CACHE_LIMITS.MAX_SESSIONS,
    ttl: ATTACH_CACHE_LIMITS.TTL_MS,
    updateAgeOnGet: true,
});

/** 세션의 누적 첨부 컨텍스트 조회 (없으면 '') */
export function getCachedAttachContext(sessionId: string): string {
    const blocks = attachContextCache.get(sessionId);
    return blocks && blocks.length > 0 ? blocks.join('') : '';
}

/**
 * 이번 턴의 첨부 컨텍스트를 세션 캐시에 누적한다.
 * 합산 글자 캡 초과 시 오래된 블록부터 통째로 제거 (블록 중간 절단으로 인한 구조 파손 방지).
 */
export function appendCachedAttachContext(sessionId: string, context: string): void {
    if (!sessionId || !context) return;
    const blocks = [...(attachContextCache.get(sessionId) || []), context];
    let total = blocks.reduce((sum, b) => sum + b.length, 0);
    while (blocks.length > 1 && total > ATTACH_CACHE_LIMITS.MAX_CHARS) {
        total -= (blocks.shift() as string).length;
    }
    attachContextCache.set(sessionId, blocks);
}

/** 테스트용 — 캐시 전체 초기화 */
export function clearAttachContextCache(): void {
    attachContextCache.clear();
}
