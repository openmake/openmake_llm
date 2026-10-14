/**
 * /task 의 디스코드 연결 — 명령·버튼 상호작용이 조정자에 맞게 이어지고 답이 맞는 방식으로 나가는지,
 * 가짜 상호작용 객체로 고정한다(실제 디스코드 접속 없음).
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interaction } from 'discord.js';
import type { DecideResult, StartResult, TaskController } from './task-commands';
import { delegatedTaskUi, handleDisabledTaskInteraction, handleTaskInteraction } from './task-discord';

function controller(over: Partial<TaskController> = {}) {
    const calls: string[] = [];
    const c: TaskController = {
        isEnabled: () => true,
        start: async (req): Promise<StartResult> => { calls.push(`start:${req.userId}:${req.channelId}:${req.goal}`); return { ok: true, taskId: '8da742a6-661e' }; },
        cancel: async (req) => { calls.push(`cancel:${req.userId}:${req.channelId}`); return '취소를 요청했습니다.'; },
        decide: async (req): Promise<DecideResult> => { calls.push(`decide:${req.userId}:${req.approvalId}:${req.decision}`); return { settled: true, text: '✅ 승인됨' }; },
        trackApproval: (approvalId, ownerId) => { calls.push(`track:${approvalId}:${ownerId}`); },
        ...over,
    };
    return { c, calls };
}

/** 슬래시 명령 상호작용의 최소 모양 */
function command(name: string, opts: { goal?: string; channel?: unknown } = {}) {
    const out: string[] = [];
    const i = {
        isChatInputCommand: () => true,
        isButton: () => false,
        commandName: name,
        user: { id: 'u1' },
        channelId: 'c1',
        channel: 'channel' in opts ? opts.channel : { send: async () => ({ edit: async () => undefined }) },
        options: { getString: () => opts.goal ?? '' },
        deferReply: async (o: { flags?: number }) => { out.push(`defer:${o.flags === 64}`); },
        reply: async (o: unknown) => { out.push(`reply:${JSON.stringify(o)}`); },
        editReply: async (text: string) => { out.push(`edit:${text}`); },
    };
    return { i: i as unknown as Interaction, out };
}

/** 버튼 상호작용의 최소 모양 */
function button(customId: string) {
    const out: unknown[] = [];
    const i = {
        isChatInputCommand: () => false,
        isButton: () => true,
        customId,
        user: { id: 'u1' },
        message: { content: '⚠️ 승인이 필요합니다 — bash' },
        deferUpdate: async () => { out.push('deferUpdate'); },
        editReply: async (o: unknown) => { out.push(['edit', o]); },
        followUp: async (o: unknown) => { out.push(['followUp', o]); },
        reply: async (o: unknown) => { out.push(['reply', o]); },
    };
    return { i: i as unknown as Interaction, out };
}

test('/task: 먼저 본인에게만 보이게 접수하고, 목표와 사용자·채널을 조정자에 넘긴 뒤 시작을 알린다', async () => {
    const { c, calls } = controller();
    const { i, out } = command('task', { goal: '로그 집계' });
    assert.equal(await handleTaskInteraction(i, c), true);
    assert.deepEqual(calls, ['start:u1:c1:로그 집계']);
    assert.equal(out[0], 'defer:true');
    assert.match(out[1], /^edit:작업을 시작했습니다/);
});

test('/task: 시작이 거절되면 그 사유를 답한다', async () => {
    const { c } = controller({ start: async () => ({ ok: false, reason: '이 명령을 쓸 권한이 없습니다.' }) });
    const { i, out } = command('task', { goal: 'x' });
    await handleTaskInteraction(i, c);
    assert.equal(out[1], 'edit:⚠️ 이 명령을 쓸 권한이 없습니다.');
});

test('/task: 메시지를 올릴 수 없는 채널(없음·send 없음)에서는 조정자를 부르지 않는다', async () => {
    for (const channel of [null, {}]) {
        const { c, calls } = controller();
        const { i, out } = command('task', { goal: 'x', channel });
        assert.equal(await handleTaskInteraction(i, c), true);
        assert.deepEqual(calls, []);
        assert.match(out[1], /메시지를 올릴 수 없어/);
    }
});

test('/task-cancel: 조정자의 답을 그대로 전한다', async () => {
    const { c, calls } = controller();
    const { i, out } = command('task-cancel');
    assert.equal(await handleTaskInteraction(i, c), true);
    assert.deepEqual(calls, ['cancel:u1:c1']);
    assert.deepEqual(out, ['defer:true', 'edit:취소를 요청했습니다.']);
});

test('버튼: 끝난 요청은 원래 문구에 결과를 덧붙이고 버튼을 지운다 — 승인 id 의 구분자도 그대로 넘긴다', async () => {
    const { c, calls } = controller();
    const { i, out } = button('task:approve:apv_05cd9eb5-5ce9_mv5xxb0w_0');
    assert.equal(await handleTaskInteraction(i, c), true);
    assert.deepEqual(calls, ['decide:u1:apv_05cd9eb5-5ce9_mv5xxb0w_0:approve']);
    assert.deepEqual(out, ['deferUpdate', ['edit', { content: '⚠️ 승인이 필요합니다 — bash\n✅ 승인됨', components: [] }]]);
});

test('버튼: 끝나지 않은 요청(권한 없음 등)은 버튼을 남기고 누른 사람에게만 알린다', async () => {
    const { c } = controller({ decide: async () => ({ settled: false, text: '작업을 시작한 사람만 할 수 있습니다.' }) });
    const { i, out } = button('task:reject:a1');
    await handleTaskInteraction(i, c);
    assert.deepEqual(out, ['deferUpdate', ['followUp', { content: '작업을 시작한 사람만 할 수 있습니다.', flags: 64 }]]);
});

test('이 모듈의 것이 아닌 상호작용은 건드리지 않는다', async () => {
    const { c, calls } = controller();
    assert.equal(await handleTaskInteraction(command('reset').i, c), false);
    assert.equal(await handleTaskInteraction(button('other:approve:a1').i, c), false);
    assert.equal(await handleTaskInteraction(button('task:delete:a1').i, c), false);
    assert.deepEqual(calls, []);
});

test('진행 표시: 고치기가 실패하면(메시지가 지워짐 등) 새 메시지로 다시 올린다', async () => {
    const sends: string[] = [];
    const channel = { send: async (o: { content: string }) => { sends.push(o.content); return { edit: async () => { throw new Error('Unknown Message'); } }; } };
    const { c } = controller({ start: async (req) => { await req.ui.updateStatus('첫 표시'); await req.ui.updateStatus('둘째 표시'); return { ok: true, taskId: 't1' }; } });
    await handleTaskInteraction(command('task', { goal: 'x', channel }).i, c);
    assert.deepEqual(sends, ['첫 표시', '둘째 표시']);
});

test('기능이 꺼진 봇: 남아 있는 /task 명령과 승인 버튼에 꺼져 있다고 답한다(무응답으로 두지 않는다)', async () => {
    for (const name of ['task', 'task-cancel']) {
        const { i, out } = command(name);
        assert.equal(await handleDisabledTaskInteraction(i), true);
        assert.match(String(out[0]), /^reply:.*꺼져 있습니다.*"flags":64/);
    }
    const b = button('task:approve:a1');
    assert.equal(await handleDisabledTaskInteraction(b.i), true);
    assert.match(JSON.stringify(b.out[0]), /꺼져 있습니다/);
    assert.equal(await handleDisabledTaskInteraction(command('reset').i), false);
    assert.equal(await handleDisabledTaskInteraction(button('other:approve:a1').i), false);
});

test('delegatedTaskUi: 승인 주인을 적을 수 있으면 버튼과 함께 올리고, 아니면 버튼 없이 웹 승인 안내', async () => {
    const approval = { approvalId: 'ap-1', toolName: 'run_command', args: { command: 'ls' } };
    const sent: Array<{ content: string; components?: unknown[] }> = [];
    const channel = { send: async (o: { content: string; components?: unknown[] }) => { sent.push(o); return {} as never; } };

    const tracked: string[] = [];
    await delegatedTaskUi(channel as never, (a) => tracked.push(a.approvalId)).postApproval(approval as never);
    assert.deepEqual(tracked, ['ap-1']);
    assert.equal(sent[0].components?.length, 1);

    await delegatedTaskUi(channel as never, null).postApproval(approval as never);
    assert.equal(sent[1].components, undefined);
    assert.match(sent[1].content, /run_command/);
    assert.match(sent[1].content, /웹의 작업 화면에서 승인하세요/);
});
