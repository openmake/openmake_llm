/**
 * 로컬 기기 오류 — 레지스트리·실행기를 끌어오지 않고 판별할 수 있게 따로 둔다.
 * @module services/local-bridge/device-errors
 */

/** 작업이 쓸 로컬 기기가 연결돼 있지 않다 — 실행기를 준비하지 못했다(기기 대기의 근거). */
export class LocalDeviceUnavailableError extends Error {
    constructor() {
        super('연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 먼저 연결하세요.');
        this.name = 'LocalDeviceUnavailableError';
    }
}

/**
 * 도구 실행 중 기기가 사라졌다는 신호 — 기기 대기 주차의 방식이 갈린다.
 *   rerunnable : 요청이 기기에 닿지 않았거나 읽기였다. 결과를 남기지 않고 주차하고 재개 때 다시 실행한다.
 *   unknown    : 쓰기·실행 요청을 보낸 뒤 끊겼다. 결과 불명 안내를 남기고 주차한다(다시 실행하지 않는다).
 *   browser_takeover : 기기는 그대로지만 사용자가 브라우저를 넘겨받아 요청을 실행하지 않고 거절했다(2026-10-05).
 *                      결과를 남기지 않고 넘겨받기 사유로 주차하고, 돌려받으면 같은 호출을 다시 실행한다.
 */
export type DeviceLoss = 'rerunnable' | 'unknown' | 'browser_takeover';

/**
 * 디바이스가 모르는 kind 를 받았을 때 돌려주는 오류 문구의 접두(`지원하지 않는 kind: <kind>`).
 * 출처: TS `packages/local-bridge-core/src/core.ts` 의 dispatch default 가지, Rust
 * `apps/openmake-code/crates/omk-bridge-core/src/core.rs` 의 `unsupported()`, 적합성 fixture
 * `packages/local-bridge-core/conformance/file-kinds.json`(device-errors.test 가 대조한다).
 * 디바이스 코어와 짝인 프로토콜 문구라 env 로 바꾸지 않는다.
 */
export const BRIDGE_UNSUPPORTED_KIND_PREFIX = '지원하지 않는 kind';

/**
 * 디바이스가 code_nav grep 의 정규식을 해석하지 못했을 때 돌려주는 오류 문구의 접두(`정규식이 올바르지 않습니다: <엔진 메시지>`).
 * 출처: 적합성 fixture `packages/local-bridge-core/conformance/code-nav.json` 의 `errorPrefix`(device-errors.test 가 대조한다).
 * 서버는 이 접두로 기기(JavaScript 엔진) 문법 힌트를 붙인다(tools-code-nav). 디바이스 코어와 짝인 프로토콜 문구라 env 로 바꾸지 않는다.
 */
export const BRIDGE_INVALID_REGEX_PREFIX = '정규식이 올바르지 않습니다: ';

/** 구 디바이스의 "모르는 kind" 응답인가 — 아니면 디바이스가 요청을 받아 거절한 요청 오류다. */
export function isUnsupportedKindError(error: string): boolean {
    return error.startsWith(BRIDGE_UNSUPPORTED_KIND_PREFIX);
}

/**
 * 디바이스가 worktree add 를 git 저장소가 아니어서 거절할 때 돌려주는 오류 문구(완전 일치).
 * 출처: TS `packages/local-bridge-core/src/worktree.ts` 의 NOT_A_REPO, Rust `omk-bridge-core/src/worktree.rs`, 적합성 fixture
 * `packages/local-bridge-core/conformance/worktree.json` 의 `add-not-a-repo`(device-errors.test 가 대조한다).
 * 문구가 바뀌면 격리 상태가 not_repo 대신 unavailable(경고)로 떨어진다 — 과잉 경고 쪽이라 안전하다. env 로 바꾸지 않는다.
 */
export const BRIDGE_NOT_A_REPO_ERROR = 'git 레포가 아닙니다';

/** worktree add 가 "git 저장소 아님" 으로 거절됐는가 — 아니면 격리를 시도했으나 실패한 것이다. */
export function isNotARepoError(error: string): boolean {
    return error === BRIDGE_NOT_A_REPO_ERROR;
}
