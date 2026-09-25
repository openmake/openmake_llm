/**
 * music-runtime — 부를 가사 우선순위 (2026-09-26): 계획 인자 → 앞 작업 결과 → 대화(표시 또는 붙여 넣은 가사).
 */
import { musicGenerateHandler } from '../generate';
import { PLAN_CONVERSATION_TEXT_MARKER } from '../../../config/capabilities';
import type { CapabilityContext } from '../../../capability-contract/types';
import type { PlanTask } from '../../../services/orchestrator/plan-schema';

const invokes: Array<Record<string, unknown>> = [];
const PASTE = '[Verse]\n바람이 분다\n\n[Chorus]\n우리 함께 가자\n\n이 가사로 노래 만들어줘';
const ANSWER = '가사를 정리했습니다.\n\n## Verse 1\n아침이 내린다\n\n## Chorus\n삼천리 방방곡곡';

function ctx(over: Partial<CapabilityContext> = {}): CapabilityContext {
    return {
        lang: 'ko', userMessage: '노래로 만들어줘', attachments: new Map(), results: new Map(), userId: 'u1',
        invocation: { taskId: 't1', capability: 'music.generate', owner: { addonId: 'music-runtime', addonVersion: '1.0.0', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 },
        model: {
            describe: () => ({ providerId: 'local-llm', model: 'acestep-v15-xl-turbo', fullId: 'local-llm:acestep-v15-xl-turbo', source: 'default', costOwner: 'local', transport: 'gateway', params: {} }),
            invokeJson: async (req) => { invokes.push(req.payload as Record<string, unknown>); return { choices: [{ message: { audio: [{ audio_url: { url: `data:audio/mpeg;base64,${Buffer.from([0xff, 0xfb, 0x90, 0]).toString('base64')}` } }] } }] } as never; },
            invokeBinary: async () => { throw new Error('unused'); }, download: async () => { throw new Error('unused'); },
        },
        artifacts: { save: async (i) => ({ id: '1', mimeType: i.mime, fileName: `tts-1.${i.ext}`, sizeBytes: i.bytes.length, urlPath: `/generated/tts-1.${i.ext}` }), read: async () => { throw new Error('unused'); } },
        jobs: { submit: async () => { throw new Error('unused'); }, get: async () => null, findByExternal: async () => null, advance: async () => null },
        traceId: 't', ...over,
    };
}
const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'music.generate', instruction: 'k-pop ballad', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...o });

beforeEach(() => { invokes.length = 0; });

test('표시(CONVERSATION)면 사용자 메시지의 가사를 쓴다 — 요청 문장은 빼고', async () => {
    await musicGenerateHandler.execute(task({ extra: { lyrics: PLAN_CONVERSATION_TEXT_MARKER } }), ctx({ userMessage: PASTE }));
    expect(invokes[0].lyrics).toBe('[Verse]\n바람이 분다\n\n[Chorus]\n우리 함께 가자');
});

test('표시면 사용자 메시지에 없을 때 최근 답변(아티팩트 펼친 본문)에서 찾는다', async () => {
    await musicGenerateHandler.execute(task({ extra: { lyrics: PLAN_CONVERSATION_TEXT_MARKER } }), ctx({ recentAssistantMessages: [ANSWER] }));
    expect(invokes[0].lyrics).toBe('[Verse 1]\n아침이 내린다\n\n[Chorus]\n삼천리 방방곡곡');
});

test('표시인데 대화에 가사가 없으면 원인을 밝혀 실패한다 — 표시 문자열을 노래하지 않는다', async () => {
    await expect(musicGenerateHandler.execute(task({ extra: { lyrics: PLAN_CONVERSATION_TEXT_MARKER } }), ctx())).rejects.toThrow(/대화에서 가사를 찾지 못했습니다/);
    expect(invokes).toHaveLength(0);
});

test('Planner 가 표시를 빠뜨려도 가사를 붙여 넣은 요청이면 그 가사를 쓴다 (연주곡이 되지 않게)', async () => {
    await musicGenerateHandler.execute(task(), ctx({ userMessage: PASTE }));
    expect(invokes[0].lyrics).toContain('[Chorus]\n우리 함께 가자');
});

test('계획이 가사를 직접 줬거나 연주곡 요청이면 대화를 보지 않는다 (종전 동작)', async () => {
    await musicGenerateHandler.execute(task({ extra: { lyrics: '직접 준 가사' } }), ctx({ userMessage: PASTE }));
    expect(invokes[0].lyrics).toBe('직접 준 가사');
    await musicGenerateHandler.execute(task(), ctx({ recentAssistantMessages: [ANSWER] }));
    expect(invokes[1]).not.toHaveProperty('lyrics');
});
