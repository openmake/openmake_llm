/**
 * 봇끼리 대화 규칙 검증 — 허용 봇 목록·명시적 호출·연속 응답 상한.
 * 실행: npm test (Node 내장 테스트 러너 + ts-node)
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Message } from 'discord.js';
import { config } from './config';
import { noteHumanMessage, resetBotTurns, shouldHandleBotMessage, tryConsumeBotTurn } from './bot-conversation';

const SELF = '100';
const PEER = '200';
const STRANGER = '300';

function botMessage(authorId: string, options: { content?: string; mentioned?: string[]; guild?: boolean } = {}): Message {
    return {
        author: { id: authorId, bot: true },
        content: options.content ?? '',
        guild: options.guild === false ? null : { id: 'g1' },
        channelId: 'c1',
        mentions: { users: new Map((options.mentioned ?? []).map((id) => [id, {}])) },
    } as unknown as Message;
}

beforeEach(() => {
    config.allowedBotIds = [PEER];
    config.botExchangeMax = 4;
    resetBotTurns();
});

test('허용 목록이 비어 있으면 다른 봇의 메시지를 받지 않는다', () => {
    config.allowedBotIds = [];
    assert.equal(shouldHandleBotMessage(botMessage(PEER, { mentioned: [SELF] }), SELF), false);
});

test('허용 목록에 없는 봇은 멘션해도 받지 않는다', () => {
    assert.equal(shouldHandleBotMessage(botMessage(STRANGER, { mentioned: [SELF] }), SELF), false);
});

test('허용된 봇이 멘션(답장 알림 포함)하면 받는다', () => {
    assert.equal(shouldHandleBotMessage(botMessage(PEER, { mentioned: [SELF] }), SELF), true);
});

test('허용된 봇의 본문에 내 멘션 표기가 있으면 알림이 꺼져 있어도 받는다', () => {
    assert.equal(shouldHandleBotMessage(botMessage(PEER, { content: `<@${SELF}> 이것 좀 봐줘` }), SELF), true);
    assert.equal(shouldHandleBotMessage(botMessage(PEER, { content: `<@!${SELF}> 이것 좀 봐줘` }), SELF), true);
});

test('허용된 봇이라도 나를 부르지 않은 메시지는 받지 않는다', () => {
    assert.equal(shouldHandleBotMessage(botMessage(PEER, { content: '혼잣말', mentioned: [STRANGER] }), SELF), false);
});

test('내 메시지는 허용 목록에 내 id 가 있어도 받지 않는다', () => {
    config.allowedBotIds = [SELF];
    assert.equal(shouldHandleBotMessage(botMessage(SELF, { mentioned: [SELF] }), SELF), false);
});

test('서버 채널 밖(DM)의 봇 메시지는 받지 않는다', () => {
    assert.equal(shouldHandleBotMessage(botMessage(PEER, { mentioned: [SELF], guild: false }), SELF), false);
});

test('사람 메시지 없이 봇에게 연속으로 답하는 횟수는 상한에서 멈춘다', () => {
    const results = [1, 2, 3, 4, 5].map(() => tryConsumeBotTurn('c1'));
    assert.deepEqual(results, [true, true, true, true, false]);
});

test('사람이 그 채널에 글을 쓰면 연속 횟수가 처음부터 다시 센다', () => {
    for (let i = 0; i < 5; i += 1) tryConsumeBotTurn('c1');
    noteHumanMessage('c1');
    assert.equal(tryConsumeBotTurn('c1'), true);
});

test('연속 횟수는 채널마다 따로 센다', () => {
    for (let i = 0; i < 5; i += 1) tryConsumeBotTurn('c1');
    assert.equal(tryConsumeBotTurn('c2'), true);
});
