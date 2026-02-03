/**
 * Error thrown when API quota is exceeded (hourly or weekly).
 * Should result in HTTP 429 Too Many Requests response.
 */
export class QuotaExceededError extends Error {
    public readonly quotaType: 'hourly' | 'weekly' | 'both';
    public readonly used: number;
    public readonly limit: number;
    public readonly retryAfterSeconds: number;

    constructor(quotaType: 'hourly' | 'weekly' | 'both', used: number, limit: number) {
        const message = `API quota exceeded (${quotaType}): ${used}/${limit} requests used`;
        super(message);
        this.name = 'QuotaExceededError';
        this.quotaType = quotaType;
        this.used = used;
        this.limit = limit;
        // Hourly quota resets faster
        this.retryAfterSeconds = quotaType === 'hourly' ? 3600 : 86400;
    }
}
