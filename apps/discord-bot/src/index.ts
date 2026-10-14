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
    MessageFlags,
    Partials,
    SlashCommandBuilder,
} from 'discord.js';
import { config, EXIT_CODE_CONFIG, loadRemoteSettings, validateConfig } from './config';
import { isUserAllowed, shouldRespond, stripBotMention } from './access-control';
import { appendTurns, getHistory, resetSession, sessionKey } from './session-store';
import { RequestTimeoutError, requestChatCompletion, resolveModel } from './openmake-client';
import { noteHumanMessage, shouldHandleBotMessage, tryConsumeBotTurn } from './bot-conversation';
import { splitForDiscord } from './message-utils';
import { prepareReply } from './attachments';
import { collectInboundAttachments, DEFAULT_ATTACHMENT_PROMPT, formatSkippedNotice } from './inbound-attachments';
import { createTaskClient } from './task-client';
import { createTaskController, type TaskController } from './task-commands';
import { handleDisabledTaskInteraction, handleTaskInteraction, registerTaskCommands } from './task-discord';

/**
 * 기동 절차: 서버(관리자 화면) 설정 수신 → 검증 → Discord 로그인.
 * CommonJS 출력이라 top-level await 을 쓸 수 없어 함수로 감싼다.
 */
async function bootstrap(): Promise<void> {
    const appliedRemote = await loadRemoteSettings();
    if (appliedRemote.length > 0) {
        console.log(`[discord-bot] 서버 설정 적용: ${appliedRemote.join(', ')}`);
    }

    const problems = validateConfig();
    if (problems.length > 0) {
        console.error('[discord-bot] 설정 오류로 기동하지 않습니다:');
        for (const p of problems) console.error(`  - ${p}`);
        console.error('[discord-bot] 관리자 화면(시스템 설정 → Discord)에서 값을 넣거나 루트 .env 를 채운 뒤 pm2 restart openmake-discord 로 재기동하세요.');
        process.exit(EXIT_CODE_CONFIG);
    }

    await client.login(config.botToken).catch((err) => {
        console.error('[discord-bot] Discord 로그인 실패:', err instanceof Error ? err.message : err);
        process.exit(1);
    });
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

/** /task 조정자 — 허용 사용자 목록이 있을 때만 만들어진다(clientReady). 없으면 기능이 꺼진 것이다. */
let taskController: TaskController | null = null;

const TYPING_REFRESH_MS = 8_000; // Discord typing 표시는 ~10초 후 소멸 → 주기 갱신

async function handleChat(message: Message, botUserId: string): Promise<void> {
    const text = stripBotMention(message.content, botUserId);
    const hasAttachments = message.attachments.size > 0;
    if (!text && !hasAttachments) return;
    // 첨부만 올린 경우 기본 문구로 요청 — 세션 이력에도 이 텍스트만 남는다(첨부는 이번 턴에만 적용)
    const content = text || DEFAULT_ATTACHMENT_PROMPT;

    const key = sessionKey(message.channelId, message.author.id);
    const channel = message.channel;
    const canType = 'sendTyping' in channel;
    if (canType) void channel.sendTyping().catch(() => {});
    const typingTimer = canType
        ? setInterval(() => void channel.sendTyping().catch(() => {}), TYPING_REFRESH_MS)
        : null;

    try {
        // 들어오는 첨부: 봇이 내려받아 이미지는 image_url, 문서는 files[] 로 전달 (서명·만료 URL 은 넘기지 않음)
        const inbound = hasAttachments
            ? await collectInboundAttachments(message.attachments.values())
            : { imageParts: [], files: [], skipped: [] };
        const answer = await requestChatCompletion(getHistory(key), content, inbound);
        // 생성 이미지·아티팩트 → 파일 첨부 + 뷰어 링크 (Discord 는 md 이미지/artifact 렌더 불가)
        const prepared = await prepareReply(answer.content, answer.artifacts);
        // 히스토리에는 항상 치환본(prepared.content) 저장 — 원문의 [[artifact:id]] placeholder 를
        // 그대로 남기면 모델이 그 표기를 모방해 실체 없는 placeholder 만 출력한다 (2026-07-21 실측)
        appendTurns(key, content, prepared.content);
        const skippedNotice = formatSkippedNotice(inbound.skipped);
        const chunks = splitForDiscord(skippedNotice ? `${prepared.content}\n${skippedNotice}` : prepared.content);
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
        if (err instanceof RequestTimeoutError) {
            console.error(`[discord-bot] 응답 실패 (${key}): 응답 제한 시간 초과 (${err.timeoutMs / 1000}s)`);
        } else {
            console.error(`[discord-bot] 응답 실패 (${key}):`, reason);
        }
        const notice = err instanceof RequestTimeoutError ? `⚠️ ${reason}` : `⚠️ 답변 생성에 실패했습니다: ${reason}`;
        await message
            .reply({ content: notice, allowedMentions: { parse: [] } })
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
        flags: MessageFlags.Ephemeral,
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
    if (!app) return;
    // 명령 등록 실패(디스코드 API 장애 등)가 봇을 죽이면 안 된다 — 이 리스너에서 새어 나간 거부는 프로세스를 끝낸다.
    // 채팅은 명령 없이도 동작하고, 명령은 한 번 등록되면 디스코드에 남는다.
    try {
        const existing = await app.commands.fetch();
        if (!existing.some((cmd) => cmd.name === 'reset')) {
            await app.commands.create(
                new SlashCommandBuilder().setName('reset').setDescription('이 채널의 내 대화 세션을 초기화합니다').toJSON(),
            );
        }
    } catch (err) {
        console.error('[discord-bot] /reset 명령 등록 실패 (기동은 계속):', err instanceof Error ? err.message : err);
    }
    // /task 는 허용 사용자 목록이 있을 때만 켠다 — 비어 있으면 명령도 등록하지 않는다.
    if (config.taskAllowedUsers.length > 0) {
        taskController = createTaskController({
            client: createTaskClient({ baseUrl: config.apiBaseUrl, apiKey: config.apiKey }),
            config: {
                allowedUsers: config.taskAllowedUsers,
                executor: config.taskExecutor,
                approvalPolicy: config.taskApprovalPolicy,
                pollMs: config.taskPollMs,
                watchMaxMs: config.taskWatchMaxMs,
            },
        });
        try {
            await registerTaskCommands(app);
        } catch (err) {
            console.error('[discord-bot] /task 명령 등록 실패 (이미 등록돼 있으면 그대로 동작):', err instanceof Error ? err.message : err);
        }
        console.log(`[discord-bot] /task 켜짐 — 허용 사용자 ${config.taskAllowedUsers.length}명, 실행 위치 ${config.taskExecutor}, 승인 ${config.taskApprovalPolicy}`);
    }
});

client.on('messageCreate', async (message) => {
    const botUserId = client.user?.id;
    if (!botUserId) return;
    if (message.author.bot) {
        // 허용된 봇이 나를 불렀을 때만, 연속 상한 안에서 답한다 (사용자 접근 제어 대신 봇 허용 목록이 기준)
        if (!shouldHandleBotMessage(message, botUserId)) return;
        if (!tryConsumeBotTurn(message.channelId)) {
            console.log(`[discord-bot] 봇끼리 연속 응답 상한(${config.botExchangeMax}) — 채널 ${message.channelId} 에서 사람 메시지가 올 때까지 봇에게 답하지 않습니다.`);
            return;
        }
        await handleChat(message, botUserId);
        return;
    }
    noteHumanMessage(message.channelId);
    if (!isUserAllowed(message)) return;
    if (!shouldRespond(message, botUserId)) return;
    await handleChat(message, botUserId);
});

client.on('interactionCreate', async (interaction) => {
    if (taskController) {
        try {
            if (await handleTaskInteraction(interaction, taskController)) return;
        } catch (err) {
            console.error('[discord-bot] /task 상호작용 실패:', err instanceof Error ? err.message : err);
            return;
        }
    } else if (config.taskAllowedUsers.length === 0 && (await handleDisabledTaskInteraction(interaction).catch(() => true))) {
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'reset') {
        await handleReset(interaction).catch((err) => console.error('[discord-bot] /reset 실패:', err));
    }
});

void bootstrap();
