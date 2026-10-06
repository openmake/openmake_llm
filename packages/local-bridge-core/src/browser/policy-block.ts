/**
 * 정책 차단 표식 — 기기가 막은 브라우저 액션의 종류·호스트(서버 감사 기록용, 2026-10-06).
 * 판정은 바꾸지 않는다: 이미 막힌 액션을 분류만 한다. 주소 전체·입력 내용은 싣지 않는다(호스트만).
 */
import { browserActionNeedsApproval, browserHostMatches, isNavigableBrowserUrl, type BrowserSitePolicy } from '@openmake/config';
import type { BrowserPolicyBlock } from '../types';

/** 액션 종류가 문자열이 아닐 때 싣는 값 */
const UNKNOWN_ACTION = 'unknown';

type ActionLike = { type?: unknown; url?: unknown };

function asAction(action: unknown): ActionLike {
    return (action && typeof action === 'object' ? action : {}) as ActionLike;
}

function actionType(a: ActionLike): string {
    return typeof a.type === 'string' ? a.type : UNKNOWN_ACTION;
}

/** checkBrowserAction 이 막은 액션의 표식 — currentHost 는 판정에 쓴 실제 탭의 호스트. */
export function browserPolicyBlockOf(action: unknown, currentHost: string | null, policy: BrowserSitePolicy): BrowserPolicyBlock {
    const a = asAction(action);
    const type = actionType(a);
    if (a.type === 'goto' && !isNavigableBrowserUrl(a.url)) return { kind: 'blocked_url', host: null, action: type };
    const host = browserActionNeedsApproval(action, currentHost, policy) || null;
    const denied = host !== null && policy.deny.some((p) => browserHostMatches(host, p));
    return { kind: denied ? 'site_denied' : 'site_off_list', host, action: type };
}

/** 사용자가 넘겨받은 상태라 막은 액션 — 탭을 보지 않으므로 호스트는 null. */
export function userControlPolicyBlock(action: unknown): BrowserPolicyBlock {
    return { kind: 'user_control', host: null, action: actionType(asAction(action)) };
}
