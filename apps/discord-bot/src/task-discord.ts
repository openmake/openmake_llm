/**
 * /task 의 디스코드 쪽 연결 — 명령 등록, 명령·버튼 상호작용을 조정자(task-commands)에 잇는다.
 * 판단(권한·상태)은 하지 않는다. 여기서는 디스코드 객체를 화면(WatchUi)으로 바꾸고 답만 보낸다.
 */
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ClientApplication,
    Interaction,
    Message,
    MessageCreateOptions,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { splitForDiscord } from './message-utils';
import type { PendingApproval } from './task-client';
import type { TaskController } from './task-commands';
import { formatApproval, type WatchUi } from './task-watcher';

export const TASK_COMMAND = 'task';
export const TASK_CANCEL_COMMAND = 'task-cancel';
/** 버튼 식별자 — `task:<approve|reject>:<승인 id>` (디스코드 상한 100자, 승인 id 는 60자 안팎) */
const BUTTON_PREFIX = 'task';

/** 메시지를 보낼 수 있는 채널의 최소 모양 — DM·스레드·서버 채널 공통 */
export interface SendableChannel {
    send(options: MessageCreateOptions): Promise<Message>;
}

/**
 * 명령 등록 — 기존 /reset 과 같은 방식(전역 명령을 통째로 바꾸지 않고 없을 때만 추가).
 * 기능이 켜져 있을 때만 부른다.
 */
export async function registerTaskCommands(app: ClientApplication): Promise<void> {
    const existing = await app.commands.fetch();
    if (!existing.some((cmd) => cmd.name === TASK_COMMAND)) {
        await app.commands.create(
            new SlashCommandBuilder()
                .setName(TASK_COMMAND)
                .setDescription('에이전트 작업을 시작합니다 — 진행·승인·결과가 이 채널에 올라옵니다')
                .addStringOption((option) => option.setName('goal').setDescription('작업 목표').setRequired(true))
                .toJSON(),
        );
    }
    if (!existing.some((cmd) => cmd.name === TASK_CANCEL_COMMAND)) {
        await app.commands.create(
            new SlashCommandBuilder().setName(TASK_CANCEL_COMMAND).setDescription('이 채널에서 진행 중인 내 작업을 취소합니다').toJSON(),
        );
    }
}

function approvalButtons(approval: PendingApproval): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:approve:${approval.approvalId}`).setLabel('승인').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:reject:${approval.approvalId}`).setLabel('거절').setStyle(ButtonStyle.Danger),
    );
}

/** 채널을 지켜보기용 화면으로 — 진행 표시는 메시지 하나를 올리고 그 뒤로는 고친다 */
function channelUi(channel: SendableChannel): WatchUi {
    let statusMessage: Message | null = null;
    return {
        async updateStatus(text) {
            if (statusMessage) {
                try {
                    await statusMessage.edit({ content: text });
                    return;
                } catch {
                    // 메시지가 지워졌거나 고칠 수 없다 — 아래에서 새 메시지로 다시 올린다
                    statusMessage = null;
                }
            }
            statusMessage = await channel.send({ content: text, allowedMentions: { parse: [] } });
        },
        async postApproval(approval) {
            await channel.send({ content: formatApproval(approval), components: [approvalButtons(approval)], allowedMentions: { parse: [] } });
        },
        async postFinal(text) {
            for (const chunk of splitForDiscord(text)) {
                await channel.send({ content: chunk, allowedMentions: { parse: [] } });
            }
        },
    };
}

const MSG_APPROVE_ON_WEB = '웹의 작업 화면에서 승인하세요.';

/**
 * 채팅에서 위임한 작업을 지켜보는 화면 — /task 와 같은 채널 화면을 쓰되 승인 요청만 다르다.
 * onApproval 이 있으면(/task 가 켜져 있고 요청한 사람이 허용 목록에 있을 때) 승인 버튼을 올리고 주인을 적게 하고,
 * 없으면 버튼 없이 웹에서 승인하라는 안내만 붙인다(아무나 위험 도구를 승인하지 못하게).
 */
export function delegatedTaskUi(channel: SendableChannel, onApproval: ((approval: PendingApproval) => void) | null): WatchUi {
    const ui = channelUi(channel);
    return {
        ...ui,
        async postApproval(approval) {
            if (onApproval) {
                onApproval(approval);
                await ui.postApproval(approval);
                return;
            }
            await channel.send({ content: `${formatApproval(approval)}\n${MSG_APPROVE_ON_WEB}`, allowedMentions: { parse: [] } });
        },
    };
}

/** @returns 이 모듈이 처리한 상호작용이면 true */
export async function handleTaskInteraction(interaction: Interaction, controller: TaskController): Promise<boolean> {
    if (interaction.isChatInputCommand() && interaction.commandName === TASK_COMMAND) {
        // 작업 생성·실행 호출이 3초(디스코드 응답 기한)를 넘을 수 있어 먼저 접수한다. 답은 본인에게만 보인다.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const channel = interaction.channel;
        if (!channel || !('send' in channel)) {
            await interaction.editReply('이 채널에는 메시지를 올릴 수 없어 작업을 시작하지 않았습니다.');
            return true;
        }
        const result = await controller.start({
            userId: interaction.user.id,
            channelId: interaction.channelId,
            goal: interaction.options.getString('goal', true),
            ui: channelUi(channel as unknown as SendableChannel),
        });
        await interaction.editReply(result.ok ? `작업을 시작했습니다. 진행 상황이 이 채널에 올라옵니다. (작업 ${result.taskId.slice(0, 8)})` : `⚠️ ${result.reason}`);
        return true;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === TASK_CANCEL_COMMAND) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await interaction.editReply(await controller.cancel({ userId: interaction.user.id, channelId: interaction.channelId }));
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${BUTTON_PREFIX}:`)) {
        const [, decision, ...rest] = interaction.customId.split(':');
        if (decision !== 'approve' && decision !== 'reject') return false;
        await interaction.deferUpdate();
        const result = await controller.decide({ userId: interaction.user.id, approvalId: rest.join(':'), decision });
        if (result.settled) {
            // 끝난 요청은 버튼을 지우고 결과를 원래 메시지에 덧붙인다
            await interaction.editReply({ content: `${interaction.message.content}\n${result.text}`, components: [] });
        } else {
            await interaction.followUp({ content: result.text, flags: MessageFlags.Ephemeral });
        }
        return true;
    }

    return false;
}

const MSG_DISABLED = '이 봇에서는 /task 기능이 꺼져 있습니다.';

/**
 * 기능이 꺼진 봇에 남아 있는 /task 명령·승인 버튼 — 답하지 않으면 디스코드가 "응답하지 않았습니다"를 띄운다.
 * (명령은 지우지 않는다: 같은 봇 앱을 다른 gateway 와 함께 쓰는 경우가 있어 이름만으로 내 것인지 알 수 없다.)
 * @returns 이 모듈의 상호작용이어서 답했으면 true
 */
export async function handleDisabledTaskInteraction(interaction: Interaction): Promise<boolean> {
    const isTaskCommand = interaction.isChatInputCommand() && (interaction.commandName === TASK_COMMAND || interaction.commandName === TASK_CANCEL_COMMAND);
    const isTaskButton = interaction.isButton() && interaction.customId.startsWith(`${BUTTON_PREFIX}:`);
    if (!isTaskCommand && !isTaskButton) return false;
    await interaction.reply({ content: MSG_DISABLED, flags: MessageFlags.Ephemeral });
    return true;
}
