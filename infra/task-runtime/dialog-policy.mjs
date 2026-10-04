/**
 * dialog-policy — 페이지가 띄운 확인창(alert·confirm·prompt·beforeunload)을 어떻게 닫을지와 그 기록.
 *
 * 종전에는 듣는 쪽이 없어 Playwright 가 말없이 취소했고, 모델은 확인창이 떴다는 것조차 몰랐다
 * ("삭제" 를 눌렀는데 아무 일도 없는 이유를 알 수 없음). 기본 동작은 종전과 같게 두고(confirm·prompt 취소),
 * 뜬 확인창을 결과에 싣고, `dialog` 액션으로 이후의 confirm·prompt 를 수락하게 바꿀 수 있게 한다.
 */

/** 결과에 싣는 문구 길이 상한. */
const MESSAGE_MAX = 300;
/** 한 액션에서 기록하는 확인창 수 상한(반복해서 띄우는 페이지 대비). */
const RECORD_MAX = 20;

export function createDialogPolicy() {
    let accept = false;
    let promptText;
    let seen = [];
    return {
        /** `dialog` 액션 — 이후 뜨는 confirm·prompt 에 적용한다. */
        set(action) {
            if (typeof action?.accept !== 'boolean') throw new Error('dialog 액션에는 accept(true/false)가 필요합니다');
            accept = action.accept;
            promptText = action.accept && action.promptText != null ? String(action.promptText) : undefined;
        },
        /** alert 은 확인뿐이고, beforeunload 를 취소하면 이동이 막히므로 둘은 항상 받는다. */
        decide(type) {
            if (type === 'alert' || type === 'beforeunload') return { accept: true };
            if (!accept) return { accept: false };
            return type === 'prompt' && promptText !== undefined ? { accept: true, promptText } : { accept: true };
        },
        record(type, message, decision) {
            if (seen.length >= RECORD_MAX) return;
            seen.push({ type, message: String(message ?? '').slice(0, MESSAGE_MAX), handled: decision.accept ? 'accepted' : 'dismissed' });
        },
        /** 지금까지 기록한 확인창을 돌려주고 비운다. */
        drain() {
            const out = seen;
            seen = [];
            return out;
        },
    };
}
