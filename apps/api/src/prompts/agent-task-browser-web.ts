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
