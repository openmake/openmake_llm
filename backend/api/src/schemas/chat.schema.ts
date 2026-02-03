/**
 * Chat Zod Schemas
 */
import { z } from 'zod';

const chatMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string()
});

export const chatRequestSchema = z.object({
    message: z.string().min(1, '메시지를 입력하세요').max(100000),
    history: z.array(chatMessageSchema).optional(),
    model: z.string().optional(),
    nodeId: z.string().optional(),
    sessionId: z.string().optional(),
    anonSessionId: z.string().optional(),
    docId: z.string().optional(),
    images: z.array(z.string()).optional(),
    discussionMode: z.boolean().optional(),
    thinkingMode: z.boolean().optional(),
    thinkingLevel: z.enum(['low', 'medium', 'high']).optional(),
    webSearch: z.boolean().optional()
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
