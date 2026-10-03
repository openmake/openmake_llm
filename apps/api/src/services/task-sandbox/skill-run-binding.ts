/**
 * skill_run 승인 결속 — 승인 때 본 절차와 실제 실행되는 절차를 같게 한다.
 *
 * skill_run 의 인자는 skill_id 와 params 뿐이라 승인 카드에 실행될 코드가 보이지 않았고, 절차는 승인 **뒤에** 불러왔다
 * (skill_id 가 정확히 맞지 않으면 이름·설명으로도 매칭된다). 승인한 것과 실행되는 것이 달라질 수 있었다.
 *
 * - 승인 전에 절차를 불러 인자에 체크섬을 묶고(승인 인자 해시에 함께 들어간다), 절차 본문을 미리보기로 싣는다.
 * - 실행 단계(tools.ts skill_run)는 다시 불러온 절차의 체크섬이 묶인 값과 다르면 실행하지 않는다.
 *
 * @module services/task-sandbox/skill-run-binding
 */
import { hashApprovalArgs } from '../../data/repositories/agent-task-approval-repository';
import { APPROVAL_PREVIEW } from '../../config/task-sandbox';

/** 체크섬을 싣는 인자 이름 — 모델이 넣은 값은 결속 단계가 덮어쓴다. */
export const SKILL_RUN_CHECKSUM_ARG = 'spec_checksum';

/** 실행에 쓰이는 절차 필드만 — 이름·목표 같은 설명 필드는 실행 내용이 아니다. */
interface ProcedureBody {
    kind: 'browser' | 'script';
    actions?: unknown[];
    allowlist?: string[];
    lang?: 'bash' | 'python';
    code?: string;
    /** 치환 파라미터 이름 — 실행 내용이 아니라 체크섬에 넣지 않는다 */
    params?: string[];
}

/** PURE: 절차 본문의 체크섬(키 순서 무관). */
export function procedureChecksum(spec: ProcedureBody): string {
    return hashApprovalArgs({ kind: spec.kind, actions: spec.actions, allowlist: spec.allowlist, lang: spec.lang, code: spec.code });
}

/** PURE: 승인 카드에 보일 절차 본문 — 스크립트는 언어와 코드, 브라우저는 액션과 허용 도메인. */
export function buildSkillRunPreview(spec: ProcedureBody): string {
    const body = spec.kind === 'script'
        ? `[script · ${spec.lang ?? 'bash'}]\n${spec.code ?? ''}`
        : `[browser]\n허용 도메인: ${(spec.allowlist ?? []).join(', ') || '(없음)'}\n${JSON.stringify(spec.actions ?? [], null, 2)}`;
    return body.length > APPROVAL_PREVIEW.DIFF_MAX_CHARS ? `${body.slice(0, APPROVAL_PREVIEW.DIFF_MAX_CHARS)}\n...[길어 잘렸습니다]` : body;
}

/**
 * 승인 전에 절차를 불러 인자에 체크섬을 묶는다(제자리 갱신). 돌려주는 값은 승인 카드용 미리보기.
 * 절차를 못 찾으면 체크섬을 지우고 null — 실행 단계가 "찾지 못함"으로 답한다.
 */
export async function bindSkillRunApproval(
    args: Record<string, unknown>,
    load: (skillId: string) => Promise<ProcedureBody | null>,
): Promise<string | null> {
    delete args[SKILL_RUN_CHECKSUM_ARG];
    const spec = await load(String(args.skill_id ?? '').trim()).catch(() => null);
    if (!spec) return null;
    args[SKILL_RUN_CHECKSUM_ARG] = procedureChecksum(spec);
    return buildSkillRunPreview(spec);
}
