import * as http2 from 'http2';
import * as jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

export interface NativePushToken {
    deviceToken: string;
    environment: 'development' | 'production';
    bundleId: string;
}

export interface NativePushPayload {
    title: string;
    body: string;
    url?: string;
}

export interface APNsDeliveryResult {
    status: number;
    reason?: string;
}

type APNsDeliver = (token: NativePushToken, payload: NativePushPayload) => Promise<APNsDeliveryResult>;

interface APNsConfig {
    keyId: string;
    teamId: string;
    privateKey: string;
}

const logger = createLogger('NativePushService');
let cachedProviderToken: { value: string; createdAt: number; fingerprint: string } | null = null;

function readAPNsConfig(): APNsConfig | null {
    const keyId = process.env.APNS_KEY_ID?.trim();
    const teamId = process.env.APNS_TEAM_ID?.trim();
    const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
    if (!keyId || !teamId || !privateKey) return null;
    return { keyId, teamId, privateKey };
}

function providerToken(config: APNsConfig): string {
    const now = Date.now();
    const fingerprint = `${config.teamId}:${config.keyId}`;
    if (cachedProviderToken
        && cachedProviderToken.fingerprint === fingerprint
        && now - cachedProviderToken.createdAt < 50 * 60 * 1000) {
        return cachedProviderToken.value;
    }
    const options: jwt.SignOptions = {
        algorithm: 'ES256',
        issuer: config.teamId,
        keyid: config.keyId,
    };
    const value = jwt.sign({}, config.privateKey, options);
    cachedProviderToken = { value, createdAt: now, fingerprint };
    return value;
}

export async function deliverAPNsNotification(
    token: NativePushToken,
    payload: NativePushPayload,
): Promise<APNsDeliveryResult> {
    const config = readAPNsConfig();
    if (!config) return { status: 0, reason: 'NotConfigured' };
    const host = token.environment === 'production'
        ? 'api.push.apple.com'
        : 'api.sandbox.push.apple.com';
    const client = http2.connect(`https://${host}`);

    return new Promise<APNsDeliveryResult>((resolve) => {
        let status = 0;
        let responseBody = '';
        let settled = false;
        const finish = (result: APNsDeliveryResult) => {
            if (settled) return;
            settled = true;
            client.close();
            resolve(result);
        };
        client.once('error', (error) => finish({ status: 0, reason: error.message }));
        const request = client.request({
            ':method': 'POST',
            ':path': `/3/device/${token.deviceToken}`,
            authorization: `bearer ${providerToken(config)}`,
            'apns-topic': token.bundleId,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'content-type': 'application/json',
        });
        request.on('response', (headers) => {
            status = Number(headers[':status'] ?? 0);
        });
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => { responseBody += chunk; });
        request.once('error', (error) => finish({ status: 0, reason: error.message }));
        request.on('end', () => {
            let reason: string | undefined;
            if (responseBody) {
                try {
                    const parsed = JSON.parse(responseBody) as { reason?: unknown };
                    if (typeof parsed.reason === 'string') reason = parsed.reason;
                } catch {
                    reason = 'InvalidAPNsResponse';
                }
            }
            finish({ status, reason });
        });
        request.end(JSON.stringify({
            aps: {
                alert: { title: payload.title, body: payload.body },
                sound: 'default',
            },
            ...(payload.url ? { url: payload.url } : {}),
        }));
    });
}

export class NativePushService {
    constructor(
        private readonly pool: Pool = getPool(),
        private readonly deliver: APNsDeliver = deliverAPNsNotification,
    ) {}

    async subscribe(
        userId: string,
        token: NativePushToken,
    ): Promise<void> {
        await this.pool.query(
            `INSERT INTO mobile_push_tokens (user_id, device_token, environment, bundle_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (device_token) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                environment = EXCLUDED.environment,
                bundle_id = EXCLUDED.bundle_id,
                updated_at = NOW()`,
            [userId, token.deviceToken, token.environment, token.bundleId],
        );
    }

    async unsubscribe(userId: string, deviceToken: string): Promise<void> {
        await this.pool.query(
            'DELETE FROM mobile_push_tokens WHERE user_id = $1 AND device_token = $2',
            [userId, deviceToken],
        );
    }

    async sendPush(userId: string, payload: NativePushPayload): Promise<void> {
        const result = await this.pool.query<{
            device_token: string;
            environment: 'development' | 'production';
            bundle_id: string;
        }>(
            `SELECT device_token, environment, bundle_id
             FROM mobile_push_tokens WHERE user_id = $1`,
            [userId],
        );
        await Promise.all(result.rows.map(async (row) => {
            const token: NativePushToken = {
                deviceToken: row.device_token,
                environment: row.environment,
                bundleId: row.bundle_id,
            };
            const outcome = await this.deliver(token, payload);
            if (outcome.status >= 200 && outcome.status < 300) {
                await this.pool.query(
                    'UPDATE mobile_push_tokens SET last_used = NOW() WHERE device_token = $1',
                    [token.deviceToken],
                );
                return;
            }
            if (outcome.status === 410 || outcome.reason === 'Unregistered' || outcome.reason === 'BadDeviceToken') {
                await this.pool.query(
                    'DELETE FROM mobile_push_tokens WHERE device_token = $1',
                    [token.deviceToken],
                );
                return;
            }
            if (outcome.reason !== 'NotConfigured') {
                logger.warn('apns.delivery_failed', {
                    status: outcome.status,
                    reason: outcome.reason,
                    environment: token.environment,
                    bundleId: token.bundleId,
                });
            }
        }));
    }
}

let nativePushService: NativePushService | null = null;

export function getNativePushService(): NativePushService {
    if (!nativePushService) nativePushService = new NativePushService();
    return nativePushService;
}
