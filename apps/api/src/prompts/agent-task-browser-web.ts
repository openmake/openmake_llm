/**
 * 브라우저·웹·MCP 영역의 모델·사용자에게 보이는 문구 (hermes 도입 2단계).
 *
 * 영역 전용 파일이다 — 공용 프롬프트 파일(agent-task-prompt)에 줄을 더하지 않으려고 따로 둔다.
 *
 * @module prompts/agent-task-browser-web
 */

/** 브라우저 명령이 도는 동안 사용자가 넘겨받아(Take control) 결과를 버렸을 때의 도구 결과. */
export const BROWSER_TAKEOVER_DISCARDED_MESSAGE =
    '브라우저 명령이 실행되는 동안 사용자가 브라우저를 넘겨받았습니다(직접 조작 중). 이 실행의 결과는 버렸습니다 — '
    + '사용자가 조작한 뒤의 화면과 다를 수 있습니다. 브라우저를 쓰지 않는 다른 일을 먼저 하거나, '
    + 'ask_human 으로 조작이 끝났는지 물은 뒤 같은 명령을 다시 실행하세요.';

/** 브라우저가 리다이렉트 등으로 막힌 주소에 도착해 결과 본문을 주지 않을 때의 도구 결과(browser-result-guard). */
export function getBrowserRedirectBlockedMessage(urls: readonly string[]): string {
    return `브라우저 결과를 전달하지 않았습니다 — 페이지가 내부망·로컬·메타데이터 주소로 이동했습니다(리다이렉트): ${urls.join(', ')}. `
        + '이 주소의 내용은 읽을 수 없습니다. 같은 주소로 다시 시도하지 말고 다른 공개 출처를 쓰세요.';
}

/** 브라우저 결과가 봇 차단·캡차 확인 화면으로 보일 때 결과 뒤에 붙이는 경고(browser-result-guard). */
export const BROWSER_BOT_BLOCK_NOTICE =
    '[경고] 이 페이지는 봇 차단·캡차 확인 화면으로 보입니다 — 추출된 내용은 요청한 페이지의 실제 내용이 아닐 수 있습니다. '
    + '같은 요청을 되풀이하지 말고 다른 공개 출처를 찾으세요. 이 사이트가 꼭 필요하면 ask_human 으로 사용자에게 '
    + '브라우저를 넘겨받아 확인을 통과해 달라고 요청하세요.';

/** MCP 결과의 비텍스트 블록 종류(addons/mcp-runtime/media-content). */
export type McpMediaKind = 'image' | 'audio';

const MCP_MEDIA_KIND_LABEL: Record<McpMediaKind, string> = { image: '이미지', audio: '오디오' };

/** MCP 결과의 이미지·오디오를 작업 공간에 저장했을 때 블록 자리에 적는 안내. */
export function getMcpMediaSavedNote(kind: McpMediaKind, relPath: string, mime: string, size: string): string {
    return `[${MCP_MEDIA_KIND_LABEL[kind]} 저장됨: ${relPath} (${mime}, ${size})]`;
}

/** MCP 결과의 이미지·오디오를 싣지 않았을 때 결과 끝에 적는 안내 — items 는 "종류 크기" 목록. */
export function getMcpMediaOmittedNote(kind: McpMediaKind, items: readonly string[]): string {
    return `[${MCP_MEDIA_KIND_LABEL[kind]} ${items.length}건 생략 — ${items.join(', ')}]`;
}
