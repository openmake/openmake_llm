/**
 * ============================================================
 * Sequential Thinking - 단계별 추론 체인 MCP 서버
 * ============================================================
 *
 * 복잡한 문제를 단계별 사고 프로세스로 분해하여 해결하는 MCP 도구입니다.
 * 생각의 수정(revision), 분기(branching), 재고려를 지원합니다.
 *
 * @module mcp/sequential-thinking
 * @description
 * - ThoughtRecord: 개별 사고 단계 기록
 * - SequentialThinkingServer: 사고 체인 관리 (싱글톤)
 * - Zod 기반 입력 검증 (SequentialThinkingInputSchema)
 * - 분기(branch) 관리: main + 사용자 정의 분기
 * - 시스템 프롬프트 및 질문 적용 헬퍼
 *
 * 사고 프로세스:
 * 1. 문제 분해 → 2. 단계별 분석 → 3. 가설 생성 → 4. 가설 검증 → 5. 수정/개선 → 6. 결론 도출
 */

import { z } from 'zod';

/**
 * 개별 사고 단계 기록
 *
 * 각 사고 단계의 내용, 번호, 수정/분기 정보를 저장합니다.
 *
 * @interface ThoughtRecord
 */
export interface ThoughtRecord {
    /** 현재 생각 번호 (1부터 시작) */
    thoughtNumber: number;
    /** 예상 총 생각 수 */
    totalThoughts: number;
    /** 사고 내용 텍스트 */
    thought: string;
    /** 이전 생각 수정 여부 */
    isRevision: boolean;
    /** 수정 대상 생각 번호 (isRevision=true일 때) */
    revisesThought?: number;
    /** 분기 시작점 생각 번호 */
    branchFromThought?: number;
    /** 분기 식별자 */
    branchId?: string;
    /** 기록 시각 */
    timestamp: Date;
}

/**
 * Sequential Thinking 입력 검증 스키마 (Zod)
 *
 * processThought()에 전달되는 입력을 검증합니다.
 * 필수 필드: thought, nextThoughtNeeded, thoughtNumber, totalThoughts
 */
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

/** Zod 스키마에서 추론된 입력 타입 */
export type SequentialThinkingInput = z.infer<typeof SequentialThinkingInputSchema>;

/**
 * Sequential Thinking 출력 인터페이스
 *
 * processThought()의 반환 데이터 구조입니다.
 *
 * @interface SequentialThinkingOutput
 */
export interface SequentialThinkingOutput {
    /** 현재 생각 번호 */
    thoughtNumber: number;
    /** 예상 총 생각 수 */
    totalThoughts: number;
    /** 추가 사고가 필요한지 여부 */
    nextThoughtNeeded: boolean;
    /** 모든 분기 식별자 목록 */
    branches: string[];
    /** 전체 사고 기록 수 */
    thoughtHistoryLength: number;
    /** 포맷팅된 사고 내용 (프리픽스 + 번호 + 상태 포함) */
    formattedThought: string;
}

/**
 * Sequential Thinking 서버 클래스
 *
 * 사고 체인을 관리하는 핵심 클래스입니다.
 * 사고 기록 저장, 분기 관리, 포맷팅, 요약 기능을 제공합니다.
 * getSequentialThinkingServer()로 싱글톤 인스턴스를 사용합니다.
 *
 * @class SequentialThinkingServer
 */
export class SequentialThinkingServer {
    /** 전체 사고 기록 배열 */
    private thoughtHistory: ThoughtRecord[] = [];
    /** 분기 식별자 집합 (기본값: 'main') */
    private branches: Set<string> = new Set(['main']);
    /** 현재 활성 분기 */
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
     * 현재 생각을 처리하고 기록에 추가
     *
     * 입력을 Zod 스키마로 검증한 후, 분기 처리 및 기록 저장을 수행합니다.
     * 포맷팅된 출력을 MCPToolResult 호환 형식으로 반환합니다.
     *
     * @param input - 사고 단계 입력 (Zod 검증 대상)
     * @returns 처리 결과 { isError, content } (JSON 직렬화된 SequentialThinkingOutput)
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

        } catch (error: unknown) {
            return {
                isError: true,
                content: [{
                    type: 'text',
                    text: `Error: ${(error instanceof Error ? error.message : String(error))}`
                }]
            };
        }
    }

    /**
     * 생각을 포맷팅된 문자열로 변환
     *
     * 프리픽스, 번호, 상태, 수정/분기 정보를 포함한 표시용 문자열을 생성합니다.
     *
     * @param record - 사고 기록
     * @param nextNeeded - 추가 사고 필요 여부
     * @returns 포맷팅된 문자열
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
     * 생각 번호에 따른 이모지 프리픽스 반환
     *
     * 10개의 이모지를 순환하며 시각적 구분을 제공합니다.
     *
     * @param record - 사고 기록
     * @returns 이모지 + 공백 문자열
     */
    private getThoughtPrefix(record: ThoughtRecord): string {
        const emojis = ['💭', '🤔', '💡', '🔍', '📝', '🎯', '✨', '🧠', '📊', '🔮'];
        const index = (record.thoughtNumber - 1) % emojis.length;
        return emojis[index] + ' ';
    }

    /**
     * 전체 사고 과정을 마크다운 형식으로 요약
     *
     * 모든 사고 기록을 순서대로 나열하고,
     * 총 생각 수와 분기 수를 포함한 요약을 생성합니다.
     *
     * @returns 마크다운 형식의 사고 과정 요약 문자열
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
     * 현재 서버 상태 반환
     *
     * @returns 사고 기록 수, 분기 목록, 현재 활성 분기
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

/** 싱글톤 인스턴스 저장소 */
let thinkingServerInstance: SequentialThinkingServer | null = null;

/**
 * SequentialThinkingServer 싱글톤 인스턴스 반환
 *
 * 최초 호출 시 인스턴스를 생성하고, 이후에는 동일 인스턴스를 반환합니다.
 *
 * @returns SequentialThinkingServer 싱글톤 인스턴스
 */
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

**중요: 답변 구조 규칙**
반드시 **결론(최종 답변)을 맨 먼저** 제시하고, 그 아래에 사고 과정을 보여주세요.

출력 순서:
1. \`## 결론\` — 최종 답변을 먼저 명확하게 제시
2. \`---\` — 구분선
3. 사고 과정 — 각 단계를 [1/N], [2/N] 형식으로 표시
`;

/**
 * 질문에 Sequential Thinking 시스템 프롬프트를 적용
 *
 * enableThinking=true일 때, 원본 질문에 단계별 사고 프로세스 안내를 추가합니다.
 * false이면 원본 질문을 그대로 반환합니다.
 *
 * @param question - 원본 사용자 질문
 * @param enableThinking - Sequential Thinking 적용 여부 (기본값: true)
 * @returns Sequential Thinking 프롬프트가 적용된 질문 문자열
 */
export function applySequentialThinking(question: string, enableThinking: boolean = true): string {
    if (!enableThinking) {
        return question;
    }

    return `${SEQUENTIAL_THINKING_SYSTEM_PROMPT}

사용자 질문: ${question}

위 질문에 대해 먼저 최종 결론을 "## 결론" 제목으로 제시한 후, "---" 구분선 아래에 단계별 사고 과정을 [단계번호/총단계] 형식으로 보여주세요.
`;
}
