/**
 * 인바운드 웹훅 트리거 (F16.5, 2026-09-17, 마이그레이션 132).
 *
 * 서명: `X-Openmake-Signature: sha256=hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))` + `X-Openmake-Timestamp`(epoch 초, ±창).
 * 발화: 템플릿 goal(파라미터는 기본값) + 페이로드를 데이터 경계 태그로 결정적으로 삽입 → 작업 생성 → 큐 제출.
 * 승인 정책은 트리거 설정(기본 all)과 조직 하한 중 엄격한 쪽 — 무인 실행이 파괴적 도구를 승인 없이 쓰지 못하게.
 * 템플릿은 발화 시점에 소유자가 읽을 수 있어야 한다(삭제·조직 공유 해제 반영).
 *
 * @module services/agent-task/trigger-service
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getPool, getUnifiedDatabase } from '../../data/models/unified-database';
import { AgentTaskTemplateRepository, instantiateGoal } from '../../data/repositories/agent-task-template-repository';
import { AgentTaskTriggerRepository, type AgentTaskTrigger } from '../../data/repositories/agent-task-trigger-repository';
import { AGENT_TASK_LIMITS, TRIGGER_LIMITS } from '../../config/runtime-limits';
import { TRIGGER_PAYLOAD_NOTICE } from '../../prompts/agent-task-prompt';
import { membershipsFor } from '../org/membership-cache';
import { resolveEffectivePolicy, strictestApprovalPolicy } from '../org/effective-policy';
import { AgentTaskService } from '../AgentTaskService';
import { dispatchAgentTask } from './task-queue';
import { resolveUserRole } from './boot-recovery';
import type { TaskSandboxApprovalPolicy } from '../../config/task-sandbox';

export const TRIGGER_SIGNATURE_PREFIX = 'sha256=';
const PAYLOAD_PLACEHOLDER = '{{payload}}';

export function generateTriggerSecret(): string {
    return randomBytes(32).toString('base64url');
}

/** PURE: 보내는 쪽과 같은 규칙의 서명 문자열(테스트·문서 예시용). */
export function signTriggerPayload(secret: string, timestamp: string, rawBody: Buffer): string {
    return TRIGGER_SIGNATURE_PREFIX + createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

/** PURE: 타임스탬프 창 → 서명 순으로 검증. 'stale' 도 호출부는 401 로 같게 응답한다(판별 정보 노출 방지). */
export function verifyTriggerSignature(p: {
    secret: string; timestamp: string | undefined; signature: string | undefined; rawBody: Buffer; nowMs: number;
    windowSec?: number;
}): 'ok' | 'stale' | 'bad' {
    const ts = Number(p.timestamp);
    if (!p.timestamp || !Number.isInteger(ts)) return 'bad';
    if (Math.abs(p.nowMs / 1000 - ts) > (p.windowSec ?? TRIGGER_LIMITS.SIGNATURE_WINDOW_SEC)) return 'stale';
    if (!p.signature?.startsWith(TRIGGER_SIGNATURE_PREFIX)) return 'bad';
    const expected = Buffer.from(signTriggerPayload(p.secret, p.timestamp, p.rawBody));
    const given = Buffer.from(p.signature);
    return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'bad';
}

/** PURE: 페이로드 본문 — JSON 이면 들여쓰기, 아니면 UTF-8 원문. */
function payloadText(rawBody: Buffer): string {
    const text = rawBody.toString('utf8');
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

/**
 * PURE: 템플릿 goal + 페이로드 → 작업 goal. `{{payload}}` 가 있으면 그 자리, 없으면 끝에 붙인다(프롬프트 앞쪽 가변 문자열 금지).
 * goal 상한을 넘으면 페이로드만 자르고 표시한다.
 */
export function buildTriggerGoal(
    template: { goal_template: string; params?: Array<{ name: string; default?: string }> | null },
    rawBody: Buffer,
    maxChars: number = AGENT_TASK_LIMITS.GOAL_MAX_CHARS,
): string {
    const base = instantiateGoal(template.goal_template, template.params, {});
    const wrap = (body: string) => `${TRIGGER_PAYLOAD_NOTICE}\n<webhook_payload>\n${body}\n</webhook_payload>`;
    const compose = (body: string) => (base.includes(PAYLOAD_PLACEHOLDER) ? base.split(PAYLOAD_PLACEHOLDER).join(wrap(body)) : `${base}\n\n${wrap(body)}`);
    const full = payloadText(rawBody);
    const overflow = compose(full).length - maxChars;
    if (overflow <= 0) return compose(full);
    const marker = '\n...[페이로드가 길어 잘렸습니다]';
    return compose(full.slice(0, Math.max(0, full.length - overflow - marker.length)) + marker);
}

/** 템플릿을 트리거 소유자가 읽을 수 있는가 — 본인 소유 또는 소유자가 속한 조직에 공유. */
export async function templateReadable(template: { user_id?: string; org_id?: string | null }, ownerId: string): Promise<boolean> {
    if (String(template.user_id) === ownerId) return true;
    if (!template.org_id) return false;
    return (await membershipsFor(ownerId)).some((m) => m.orgId === template.org_id);
}

export class TriggerFireError extends Error {}

/** 검증을 통과한 트리거를 발화 — 작업 id 와 큐 대기 여부. 템플릿·생성 실패는 TriggerFireError(호출부가 실패 기록). */
export async function fireTrigger(trigger: AgentTaskTrigger, rawBody: Buffer): Promise<{ taskId: string; queued: boolean }> {
    const template = await new AgentTaskTemplateRepository(getPool()).get(trigger.template_id);
    if (!template || !(await templateReadable(template, trigger.user_id))) throw new TriggerFireError('template_unavailable');

    const db = getUnifiedDatabase();
    const goal = buildTriggerGoal(template, rawBody);
    const taskId = uuidv4();
    const userId = String(trigger.user_id);
    await db.createAgentTask({ id: taskId, userId, goal, maxTurns: template.max_turns });

    const approvalPolicy = strictestApprovalPolicy(trigger.approval_policy as TaskSandboxApprovalPolicy, (await resolveEffectivePolicy(userId)).approvalPolicyMin);
    const role = await resolveUserRole(db, userId);
    const service = new AgentTaskService();
    const outcome = await dispatchAgentTask({
        taskId, userId, priority: AGENT_TASK_LIMITS.QUEUE_PRIORITY_DEFAULT,
        run: () => service.execute({ taskId, goal, userId, userRole: role, maxTurns: template.max_turns, approvalPolicy }),
    });
    await new AgentTaskTriggerRepository(getPool()).recordFired(trigger.id, taskId);
    return { taskId, queued: outcome === 'queued' };
}
