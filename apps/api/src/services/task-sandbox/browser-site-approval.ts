/**
 * 로컬 브라우저 사이트 정책의 승인 결속 (Companion P2, 2026-10-04).
 *
 * 로컬 브라우저 호출은 승인 판정 전에 서버가 액션을 훑어 "허용 목록 밖 쓰기"를 찾는다(@openmake/config planBrowserActions).
 * 그 결과를 승인 판정용 인자에 `offListWrites` 로 싣는다 — 승인 바닥(approval-floor 의 site_write)이 이 필드를 보고
 * 정책·자동승인과 무관하게 사용자에게 묻게 하고, 승인 카드에는 어느 사이트에 무엇을 보내려는지가 그대로 보인다.
 *
 * `offListWrites` 는 **서버가 채운다**. 모델이 인자에 같은 이름을 넣어 와도 항상 서버 계산값으로 덮어쓴다(없으면 지운다).
 * 승인이 끝난 호출은 원래 인자 객체를 표식해 두고(WeakSet), 브라우저 도구 핸들러가 그 표식이 있을 때만 승인된 호스트를
 * 기기로 보낸다 — 승인 경로를 거치지 않은 호출이 쓰기를 실행하는 길을 닫는다.
 *
 * 업로드(uploadFile, 2026-10-06)는 허용 목록과 무관하게 계획의 `uploads` 에 실리고, 승인 판정용 인자에 `siteUploads` 로 싣는다
 * (서버가 채우고 모델 값은 덮어쓴다). 승인 바닥 site_upload 가 정책·자동승인·환경 설정과 무관하게 묻게 하고, 승인되면 그 호스트·파일
 * 목록만 기기로 보낸다(approvedUploads). 업로드를 실행할 수 없는 곳(서버 샌드박스·업로드를 모르는 구버전 기기)에서는 묻기 전에 거절한다.
 *
 * @module services/task-sandbox/browser-site-approval
 */
import type { BrowserSitePlan, BrowserSiteUpload, BrowserSiteWrite, BrowserUploadApproval } from '@openmake/config';
import { getBrowserUploadSandboxMessage, getBrowserUploadUnsupportedMessage } from '../../prompts/agent-task-prompt';

/** 승인 판정용 인자에 싣는 필드 이름 */
export const OFF_LIST_WRITES_FIELD = 'offListWrites';
/** 승인 판정용 인자에 싣는 업로드 필드 이름 — 승인 카드가 호스트·파일 이름을 이 필드에서 읽는다 */
export const SITE_UPLOADS_FIELD = 'siteUploads';
/** 업로드 액션 이름 */
const UPLOAD_ACTION = 'uploadFile';

/** PURE: 이 호출이 허용 목록 밖 쓰기를 담고 있는가 — 서버가 채운 필드로 판정한다. */
export function hasOffListSiteWrites(toolName: string, args: Record<string, unknown>): boolean {
    const v = args[OFF_LIST_WRITES_FIELD];
    return toolName === 'browser' && Array.isArray(v) && v.length > 0;
}

/** PURE: 이 호출이 업로드를 담고 있는가 — 서버가 채운 필드로 판정한다. */
export function hasSiteUploads(toolName: string, args: Record<string, unknown>): boolean {
    const v = args[SITE_UPLOADS_FIELD];
    return toolName === 'browser' && Array.isArray(v) && v.length > 0;
}

/** PURE: 승인 판정·승인 카드용 인자 사본 — 모델이 넣은 같은 이름의 값은 버리고 서버 계산값만 싣는다. */
export function withSitePlan(args: Record<string, unknown>, plan: BrowserSitePlan): Record<string, unknown> {
    const rest = { ...args };
    delete rest[OFF_LIST_WRITES_FIELD];
    delete rest[SITE_UPLOADS_FIELD];
    return {
        ...rest,
        ...(plan.offListWrites.length > 0 ? { [OFF_LIST_WRITES_FIELD]: plan.offListWrites } : {}),
        ...(plan.uploads.length > 0 ? { [SITE_UPLOADS_FIELD]: plan.uploads } : {}),
    };
}

/** PURE: 사용자 승인이 필요한 항목이 있는가(허용 목록 밖 쓰기·업로드). */
export function sitePlanNeedsApproval(plan: BrowserSitePlan): boolean {
    return plan.offListWrites.length > 0 || plan.uploads.length > 0;
}

/** PURE: 승인된 업로드 — 호스트를 알 수 없던 업로드('')는 뺀다(기기가 어떤 사이트로도 통과시키지 않는다). */
export function approvedUploadsOf(uploads: readonly BrowserSiteUpload[]): BrowserUploadApproval[] {
    return uploads.filter((u) => u.host !== '').map((u) => ({ host: u.host, files: u.files }));
}

/** PURE: 액션 배열에 업로드가 있는가. */
export function hasUploadAction(actions: unknown): boolean {
    const list = Array.isArray(actions) ? actions : [actions];
    return list.some((a) => !!a && typeof a === 'object' && (a as { type?: unknown }).type === UPLOAD_ACTION);
}

/**
 * PURE: 업로드를 실행할 수 없는 곳이면 그 사유 — 서버 샌드박스 브라우저(로컬 실행만 지원), 업로드 능력을 알리지 않은 구버전 기기.
 * 런타임은 승인을 묻기 전에, 도구 핸들러는 실행 직전에 부른다.
 */
export function browserUploadRefusal(
    actions: unknown, executor: { runBrowserSpec?: unknown; supportsBrowserUpload?: boolean },
): string | null {
    if (!hasUploadAction(actions)) return null;
    if (!executor.runBrowserSpec) return getBrowserUploadSandboxMessage();
    return executor.supportsBrowserUpload ? null : getBrowserUploadUnsupportedMessage();
}

/** PURE: 승인된 쓰기들의 호스트(중복 제거) — 호스트를 알 수 없던 쓰기('')는 뺀다(기기가 어떤 사이트로도 통과시키지 않는다). */
export function approvedHostsOf(writes: readonly BrowserSiteWrite[]): string[] {
    return [...new Set(writes.map((w) => w.host).filter((h) => h !== ''))];
}

const approvedCalls = new WeakSet<object>();

/** 이 호출(원래 인자 객체)이 사이트 쓰기 승인을 받았다고 표식한다 — 런타임이 승인 직후에 부른다. */
export function markSiteWritesApproved(args: object): void { approvedCalls.add(args); }

/** 이 호출이 사이트 쓰기 승인을 받았는가. */
export function areSiteWritesApproved(args: object): boolean { return approvedCalls.has(args); }
