/**
 * 브라우저 도구(browser) — tools.ts 에서 분리 (max-lines 가드).
 * 샌드박스: 별도 일회성 컨테이너의 chromium. 로컬 실행기(P2): 사용자 PC 전용 프로필 Chrome + 사이트 정책.
 *
 * @module services/task-sandbox/tools-browser
 */
import { getBrowserLocalBlockedMessage, getBrowserSiteApprovalRequiredMessage, getLocalBrowserToolDescription } from '../../prompts/agent-task-prompt';
import { liveFrameSpec } from '../../config/agent-task-live-view';
import { approvedHostsOf, approvedUploadsOf, areSiteWritesApproved, browserUploadRefusal, sitePlanNeedsApproval } from './browser-site-approval';
import type { MCPToolDefinition, MCPToolResult } from '../../tool-contract/types';
import type { TaskExecutor, ExecResult } from './executor';

/** tools.ts 의 공용 도우미 — 결과 포맷·임시 파일 실행·주소 검사. */
interface BrowserToolHelpers {
    textResult: (text: string, isError?: boolean) => MCPToolResult;
    formatExec: (r: ExecResult) => MCPToolResult;
    runFresh: (
        sandbox: TaskExecutor, name: { dir?: string; prefix: string; ext: string }, content: string,
        run: (relPath: string) => Promise<ExecResult>,
    ) => Promise<{ result: ExecResult; relPath: string }>;
    browserUnavailable: string;
    browserUrlBlock: (actions: readonly unknown[]) => Promise<string | null>;
}

export function createBrowserTool(
    sandbox: TaskExecutor,
    browserMetrics: ((stdout: string) => void) | undefined,
    h: BrowserToolHelpers,
): MCPToolDefinition {
    return {
        tool: {
            name: 'browser',
            description: sandbox.runBrowserSpec ? getLocalBrowserToolDescription(sandbox.supportsBrowserUpload === true) : '일회성 컨테이너의 chromium 으로 웹 브라우저를 자동화합니다(G2). 호출마다 빈 페이지(about:blank)에서 새로 시작하므로(쿠키·로그인만 유지) goto 와 이어지는 액션을 한 actions 배열에 함께 넣으세요. actions 배열을 순서대로 실행: ' +
                'goto{url} · click{selector} · fill{selector,text} · press{key} · wait{ms} · waitFor{selector} · ' +
                'screenshot{path?} · extractText{selector?} · extractHtml{selector?}. 결과를 JSON 으로 반환합니다. ' +
                '페이지가 띄운 확인창은 그 액션 결과의 dialogs 에 실립니다 — confirm·prompt 는 기본으로 취소되고, 수락하려면 ' +
                '확인창을 띄우는 액션 앞에 dialog{accept:true,promptText?} 를 넣으세요. ' +
                'CSS 셀렉터(click/fill)가 실패하면 snapshot 으로 상호작용 요소를 {role,name,index} 목록으로 얻은 뒤 ' +
                'smartClick{role,name,nth?}·smartFill{role,name,text,nth?} 로 재시도하세요(CSS 변동에 견고). ' +
                '네트워크는 샌드박스 정책(none/restricted)에 따라 제한됩니다.',
            inputSchema: {
                type: 'object',
                properties: {
                    actions: {
                        type: 'array',
                        items: { type: 'object' },
                        minItems: 1,
                        description: '액션 객체 배열. 예: [{"type":"goto","url":"https://example.com"},{"type":"extractText"}]',
                    },
                    allowlist: {
                        type: 'array',
                        description: '허용 도메인 목록(예 ["example.com"]). 비허용 호스트 요청은 차단됩니다.',
                    },
                },
                required: ['actions'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!sandbox.isBrowserEnabled) {
                return h.textResult(h.browserUnavailable, true);
            }
            // 단일 액션 객체를 넘기는 실수는 배열로 감싼다(계약 유지).
            const actions = Array.isArray(args.actions)
                ? args.actions
                : (args.actions && typeof args.actions === 'object' ? [args.actions] : null);
            if (!actions || actions.length === 0) {
                return h.textResult(
                    Array.isArray(args.actions)
                        ? 'actions 가 빈 배열입니다 — 실제 액션 객체를 최소 1개 넣으세요. '
                            + '예: [{"type":"goto","url":"https://example.com"},{"type":"extractText"}].'
                        : 'actions 배열이 필요합니다 — 예: [{"type":"goto","url":"https://example.com"},{"type":"extractText"}].',
                    true,
                );
            }
            const uploadRefusal = browserUploadRefusal(actions, sandbox); // 업로드는 업로드를 아는 로컬 기기에서만(런타임도 묻기 전에 거른다)
            if (uploadRefusal) return h.textResult(uploadRefusal, true);
            // 로컬 브라우저(P2) — 사용자 PC 의 전용 프로필 Chrome 에서 실행한다. 서버용 주소 검사(사설망 차단)는 쓰지 않는다:
            // 사내 사이트가 주된 대상이다. 대신 사이트 정책을 적용하고, 기기가 실제 탭 주소로 다시 판정한다.
            if (sandbox.planBrowserSitePolicy && sandbox.runBrowserSpec) {
                const plan = await sandbox.planBrowserSitePolicy(actions);
                if (plan.blocked.length > 0) return h.textResult(getBrowserLocalBlockedMessage(plan.blocked.map((b) => b.url)), true);
                // 허용 목록 밖 쓰기·업로드는 승인 경로(런타임의 site_write·site_upload 바닥)를 거친 호출만 실행한다.
                if (sitePlanNeedsApproval(plan) && !areSiteWritesApproved(args)) return h.textResult(getBrowserSiteApprovalRequiredMessage(), true);
                const lr = await sandbox.runBrowserSpec({ actions, approvedHosts: approvedHostsOf(plan.offListWrites), ...(plan.uploads.length > 0 ? { approvedUploads: approvedUploadsOf(plan.uploads) } : {}) });
                browserMetrics?.(lr.stdout);
                return h.formatExec(lr);
            }
            const urlBlock = await h.browserUrlBlock(actions);
            if (urlBlock) return h.textResult(urlBlock, true);
            const live = liveFrameSpec(); // 실행 중 화면을 작업 폴더 숨김 파일에 쓰게 한다(꺼져 있으면 null)
            const spec = {
                actions,
                ...(Array.isArray(args.allowlist) ? { allowlist: args.allowlist } : {}),
                ...(sandbox.browserStatePath ? { statePath: sandbox.browserStatePath } : {}),
                ...(live ? { live } : {}),
            };
            let r: ExecResult;
            try {
                // 메인 샌드박스(network none)가 아닌 별도 일회성 컨테이너에서 실행.
                ({ result: r } = await h.runFresh(
                    sandbox, { prefix: '.browser-actions', ext: '.json' }, JSON.stringify(spec),
                    (p) => sandbox.runBrowser(p),
                ));
            } catch (e) {
                return h.textResult(`액션 파일 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
            browserMetrics?.(r.stdout); // Stage 0 계측(fail-open)
            return h.formatExec(r);
        },
    };
}
