import { Agent, fetch as undiciFetch } from 'undici';

/** A shared transport avoids Node fetch's 300-second header/body idle limit.
 * The OpenAI SDK's request timeout and caller AbortSignal still apply. */
export function createLlmTransport(timeoutMs: number): { fetch: typeof globalThis.fetch; close: () => Promise<void> } {
    const dispatcher = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    const llmFetch: typeof globalThis.fetch = (input, init) => undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher },
    ) as unknown as Promise<Response>;
    return { fetch: llmFetch, close: () => dispatcher.close() };
}

const sharedTransport = createLlmTransport(1_200_000);
export const llmFetch = sharedTransport.fetch;
