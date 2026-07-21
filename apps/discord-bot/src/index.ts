/**
 * OpenMake LLM Discord gateway bot 엔트리포인트.
 * 구조 (hermes-agent gateway 동일 계열):
 *   Discord Gateway(WS, 아웃바운드) 상시 접속 → 메시지 수신 → 접근 제어/멘션 규칙
 *   → 사용자별 세션 이력 → POST /api/v1/chat/completions → Discord 회신.
 */
import {
    ChatInputCommandInteraction,
    Client,
    GatewayIntentBits,
    Message,
    Partials,
    SlashCommandBuilder,
} from 'discord.js';
import { config, EXIT_CODE_CONFIG, validateConfig } from './config';
import { isUserAllowed, shouldRespond, stripBotMention } from './access-control';
import { appendTurns, getHistory, resetSession, sessionKey } from './session-store';
import { requestChatCompletion, resolveModel } from './openmake-client';
import { splitForDiscord } from './message-utils';
import { prepareReply } from './attachments';

const problems = validateConfig();
if (problems.length > 0) {
    console.error('[discord-bot] 설정 오류로 기동하지 않습니다:');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('[discord-bot] 루트 .env 에 값을 설정한 뒤 pm2 start openmake-discord 로 재기동하세요.');
    process.exit(EXIT_CODE_CONFIG);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    // DM 채널은 partial 로 도착하므로 필수
    partials: [Partials.Channel, Partials.Message],
});

const TYPING_REFRESH_MS = 8_000; // Discord typing 표시는 ~10초 후 소멸 → 주기 갱신

async function handleChat(message: Message, botUserId: string): Promise<void> {
    const content = stripBotMention(message.content, botUserId);
    if (!content) return;

    const key = sessionKey(message.channelId, message.author.id);
    const channel = message.channel;
    const canType = 'sendTyping' in channel;
    if (canType) void channel.sendTyping().catch(() => {});
    const typingTimer = canType
        ? setInterval(() => void channel.sendTyping().catch(() => {}), TYPING_REFRESH_MS)
        : null;

    try {
        const answer = await requestChatCompletion(getHistory(key), content);
        // 생성 이미지·아티팩트 → 파일 첨부 + 뷰어 링크 (Discord 는 md 이미지/artifact 렌더 불가)
        const prepared = await prepareReply(answer.content, answer.artifacts);
        // 히스토리에는 항상 치환본(prepared.content) 저장 — 원문의 [[artifact:id]] placeholder 를
        // 그대로 남기면 모델이 그 표기를 모방해 실체 없는 placeholder 만 출력한다 (2026-07-21 실측)
        appendTurns(key, content, prepared.content);
        const chunks = splitForDiscord(prepared.content);
        try {
            await message.reply({
                content: chunks[0],
                files: prepared.files,
                allowedMentions: { repliedUser: true, parse: [] },
            });
        } catch (sendErr) {
            // 첨부 거절(업로드 한도 등) 시 답변 텍스트까지 잃지 않게 텍스트만 재전송
            if (prepared.files.length === 0) throw sendErr;
            console.warn(`[discord-bot] 첨부 전송 실패 — 텍스트만 재시도 (${key}):`, sendErr instanceof Error ? sendErr.message : sendErr);
            await message.reply({
                content: `${chunks[0]}\n⚠️ 첨부 업로드에 실패해 텍스트만 전송합니다.`,
                allowedMentions: { repliedUser: true, parse: [] },
            });
        }
        for (const chunk of chunks.slice(1)) {
            if ('send' in channel) {
                await channel.send({ content: chunk, allowedMentions: { parse: [] } });
            }
        }
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[discord-bot] 응답 실패 (${key}):`, reason);
        await message
            .reply({ content: `⚠️ 답변 생성에 실패했습니다: ${reason}`, allowedMentions: { parse: [] } })
            .catch(() => {});
    } finally {
        if (typingTimer) clearInterval(typingTimer);
    }
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
    const key = sessionKey(interaction.channelId, interaction.user.id);
    const existed = resetSession(key);
    await interaction.reply({
        content: existed ? '🔄 이 채널의 대화 세션을 초기화했습니다.' : 'ℹ️ 초기화할 세션이 없습니다.',
        ephemeral: true,
    });
}

client.once('clientReady', async () => {
    const user = client.user;
    if (!user) return;
    try {
        const model = await resolveModel();
        console.log(`[discord-bot] 로그인: ${user.tag}, 모델: ${model}, 백엔드: ${config.apiBaseUrl}`);
    } catch (err) {
        console.error('[discord-bot] 백엔드 모델 확인 실패 (기동은 계속):', err instanceof Error ? err.message : err);
    }
    // commands.set 은 전역 명령 전체를 교체해 같은 봇 앱을 공유하는 다른 gateway(hermes 등)의
    // 명령을 지워버림 — 기존 명령을 보존하고 /reset 만 없을 때 추가한다.
    const app = client.application;
    if (app) {
        const existing = await app.commands.fetch();
        if (!existing.some((cmd) => cmd.name === 'reset')) {
            await app.commands.create(
                new SlashCommandBuilder().setName('reset').setDescription('이 채널의 내 대화 세션을 초기화합니다').toJSON(),
            );
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const botUserId = client.user?.id;
    if (!botUserId) return;
    if (!isUserAllowed(message)) return;
    if (!shouldRespond(message, botUserId)) return;
    await handleChat(message, botUserId);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'reset') {
        await handleReset(interaction).catch((err) => console.error('[discord-bot] /reset 실패:', err));
    }
});

client.login(config.botToken).catch((err) => {
    console.error('[discord-bot] Discord 로그인 실패:', err instanceof Error ? err.message : err);
    process.exit(1);
});
