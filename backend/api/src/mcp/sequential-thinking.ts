/**
 * Sequential Thinking MCP 서버 통합
 * - 단계별 사고 프로세스를 통한 문제 해결
 * - 생각의 수정, 분기, 재고려 지원
 */

import { z } from 'zod';

// 생각 기록 인터페이스
export interface ThoughtRecord {
    thoughtNumber: number;
    totalThoughts: number;
    thought: string;
    isRevision: boolean;
    revisesThought?: number;
    branchFromThought?: number;
    branchId?: string;
    timestamp: Date;
}

// 입력 스키마
export const SequentialThinkingInputSchema = z.object({
    thought: z.string().describe("현재 사고 단계"),
    nextThoughtNeeded: z.boolean().describe("추가 사고가 필요한지 여부"),
    thoughtNumber: z.number().int().min(1).describe("현재 생각 번호"),
    totalThoughts: z.number().int().min(1).describe("예상 총 생각 수"),
    isRevision: z.boolean().optional().describe("이전 생각 수정 여부"),
    revisesThought: z.number().int().min(1).optional().describe("수정 대상 생각 번호"),
    branchFromThought: z.number().int().min(1).optional().describe("분기 시작점"),
    branchId: z.string().optional().describe("분기 식별자"),
    needsMoreThoughts: z.boolean().optional().describe("더 많은 생각이 필요한지")
});

export type SequentialThinkingInput = z.infer<typeof SequentialThinkingInputSchema>;

// 출력 인터페이스
export interface SequentialThinkingOutput {
    thoughtNumber: number;
    totalThoughts: number;
    nextThoughtNeeded: boolean;
    branches: string[];
    thoughtHistoryLength: number;
    formattedThought: string;
}

/**
 * Sequential Thinking 서버 클래스
 */
export class SequentialThinkingServer {
    private thoughtHistory: ThoughtRecord[] = [];
    private branches: Set<string> = new Set(['main']);
    private currentBranch: string = 'main';

    constructor() {
        this.reset();
    }

    /**
     * 상태 초기화
     */
    reset(): void {
        this.thoughtHistory = [];
        this.branches = new Set(['main']);
        this.currentBranch = 'main';
    }

    /**
     * 현재 생각 처리
     */
    processThought(input: SequentialThinkingInput): {
        isError: boolean;
        content: Array<{ type: string; text: string }>;
    } {
        try {
            // 입력 검증
            const validated = SequentialThinkingInputSchema.parse(input);

            // 분기 처리
            if (validated.branchId) {
                this.branches.add(validated.branchId);
                this.currentBranch = validated.branchId;
            }

            // 생각 기록 추가
            const record: ThoughtRecord = {
                thoughtNumber: validated.thoughtNumber,
                totalThoughts: validated.totalThoughts,
                thought: validated.thought,
                isRevision: validated.isRevision || false,
                revisesThought: validated.revisesThought,
                branchFromThought: validated.branchFromThought,
                branchId: validated.branchId,
                timestamp: new Date()
            };

            this.thoughtHistory.push(record);

            // 포맷팅된 출력 생성
            const formattedThought = this.formatThought(record, validated.nextThoughtNeeded);

            const output: SequentialThinkingOutput = {
                thoughtNumber: validated.thoughtNumber,
                totalThoughts: validated.totalThoughts,
                nextThoughtNeeded: validated.nextThoughtNeeded,
                branches: Array.from(this.branches),
                thoughtHistoryLength: this.thoughtHistory.length,
                formattedThought
            };

            return {
                isError: false,
                content: [{
                    type: 'text',
                    text: JSON.stringify(output)
                }]
            };

        } catch (error: any) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error: ${error.message}`
                }]
            };
        }
    }

    /**
     * 생각을 포맷팅된 문자열로 변환
     */
    private formatThought(record: ThoughtRecord, nextNeeded: boolean): string {
        const prefix = this.getThoughtPrefix(record);
        const status = nextNeeded ? '⏳ 계속...' : '✅ 완료';

        let formatted = `${prefix}[${record.thoughtNumber}/${record.totalThoughts}] ${record.thought}\n${status}`;

        if (record.isRevision && record.revisesThought) {
            formatted = `🔄 생각 ${record.revisesThought} 수정:\n${formatted}`;
        }

        if (record.branchId && record.branchFromThought) {
            formatted = `🌿 분기 '${record.branchId}' (${record.branchFromThought}에서):\n${formatted}`;
        }

        return formatted;
    }

    /**
     * 생각 번호에 따른 프리픽스
     */
    private getThoughtPrefix(record: ThoughtRecord): string {
        const emojis = ['💭', '🤔', '💡', '🔍', '📝', '🎯', '✨', '🧠', '📊', '🔮'];
        const index = (record.thoughtNumber - 1) % emojis.length;
        return emojis[index] + ' ';
    }

    /**
     * 전체 사고 과정 요약
     */
    getSummary(): string {
        if (this.thoughtHistory.length === 0) {
            return '사고 기록이 없습니다.';
        }

        const lines = ['## 🧠 사고 과정 요약\n'];

        for (const record of this.thoughtHistory) {
            const prefix = record.isRevision ? '🔄' : '→';
            lines.push(`${prefix} **[${record.thoughtNumber}]** ${record.thought.substring(0, 100)}${record.thought.length > 100 ? '...' : ''}`);
        }

        lines.push(`\n---\n총 ${this.thoughtHistory.length}개 생각, ${this.branches.size}개 분기`);

        return lines.join('\n');
    }

    /**
     * 현재 상태 가져오기
     */
    getState(): {
        historyLength: number;
        branches: string[];
        currentBranch: string;
    } {
        return {
            historyLength: this.thoughtHistory.length,
            branches: Array.from(this.branches),
            currentBranch: this.currentBranch
        };
    }
}

// 싱글톤 인스턴스
let thinkingServerInstance: SequentialThinkingServer | null = null;

export function getSequentialThinkingServer(): SequentialThinkingServer {
    if (!thinkingServerInstance) {
        thinkingServerInstance = new SequentialThinkingServer();
    }
    return thinkingServerInstance;
}

/**
 * Sequential Thinking을 채팅에 적용하기 위한 시스템 프롬프트
 */
export const SEQUENTIAL_THINKING_SYSTEM_PROMPT = `
당신은 Sequential Thinking을 사용하여 문제를 단계별로 분석하는 AI 어시스턴트입니다.

복잡한 질문에 답할 때 다음 프로세스를 따르세요:

1. **문제 분해**: 질문을 여러 단계로 나눕니다
2. **단계별 분석**: 각 단계를 순서대로 분석합니다
3. **가설 생성**: 분석을 바탕으로 가설을 세웁니다
4. **가설 검증**: 가설이 올바른지 확인합니다
5. **수정 및 개선**: 필요한 경우 이전 단계를 수정합니다
6. **결론 도출**: 최종 답변을 제시합니다

각 생각 단계를 [1/N], [2/N] 형식으로 표시하고, 사고 과정을 명확히 보여주세요.
`;

/**
 * 질문에 Sequential Thinking 프롬프트 적용
 */
export function applySequentialThinking(question: string, enableThinking: boolean = true): string {
    if (!enableThinking) {
        return question;
    }

    return `${SEQUENTIAL_THINKING_SYSTEM_PROMPT}

사용자 질문: ${question}

위 질문에 대해 단계별 사고 과정을 거쳐 답변해주세요. 각 단계를 [단계번호/총단계] 형식으로 표시하세요.
`;
}
