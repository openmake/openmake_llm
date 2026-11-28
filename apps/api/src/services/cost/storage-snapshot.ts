/**
 * `/generated` 보관량 일별 계상 (F25 잔여 — opt-in STORAGE_GENERATED_DAILY_SNAPSHOT_ENABLED).
 *
 * 종전 storage.generated 는 저장 시점에 "용량 × 1일" 을 한 번 기록하는 근사였다(media-io) — TTL 30일 보관이면 약 1/30 로 적게 잡힌다.
 * 소유는 `generated_artifacts`(168 — file_name·owner_user_id·size_bytes·deleted_at)가 이미 기록하므로, 하루 1회 살아 있는 행(deleted_at
 * NULL)을 소유자별로 합해 그날의 GB·일을 원장에 적재한다. 원장 idempotency_key `storage.generated:<user>:<UTC 날짜>` 로 하루 1행 —
 * 유지보수 스윕 주기마다 불러도 같은 날은 다시 쌓이지 않는다. 게스트 생성물(owner NULL)·크기 0(168 백필 행)은 제외.
 * TTL 삭제는 reapStaleGeneratedMedia 가 deleted_at 을 채우므로 스윕 뒤에 부르면 지운 파일은 세지 않는다.
 *
 * @module services/cost/storage-snapshot
 */
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { storageGeneratedDailySnapshotEnabled } from '../../config/quota-extensions';
import { COST_RATE_WILDCARD } from '../../config/cost-kinds';
import { recordCostAsync } from './cost-ledger-service';

const logger = createLogger('StorageSnapshot');
const BYTES_PER_GB = 1_000_000_000;

/** PURE: UTC 날짜 키(YYYY-MM-DD). */
export function snapshotDay(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** PURE: 원장 멱등 키 — 사용자·날짜당 1행. */
export function snapshotIdempotencyKey(userId: string, day: string): string {
    return `storage.generated:${userId}:${day}`;
}

/** 1회 실행 — 플래그 OFF 면 아무것도 하지 않는다(0). 반환은 적재를 시도한 사용자 수. */
export async function snapshotGeneratedStorage(now: number = Date.now()): Promise<number> {
    if (!storageGeneratedDailySnapshotEnabled()) return 0;
    const r = await getPool().query<{ owner_user_id: string; bytes: string }>(
        `SELECT owner_user_id, SUM(size_bytes)::text AS bytes FROM generated_artifacts
         WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL AND size_bytes > 0
         GROUP BY owner_user_id`,
    );
    const day = snapshotDay(now);
    let n = 0;
    for (const row of r.rows) {
        const bytes = Number(row.bytes);
        if (!(bytes > 0)) continue;
        try {
            await recordCostAsync({
                userId: row.owner_user_id, kind: 'storage.generated', unit: 'gb_day', rateKey: COST_RATE_WILDCARD,
                quantity: bytes / BYTES_PER_GB, costOwner: 'server', ctx: { feature: 'generated-media-snapshot' },
                meta: { day, bytes }, idempotencyKey: snapshotIdempotencyKey(row.owner_user_id, day),
            }, now);
            n++;
        } catch (e) {
            logger.warn(`보관량 계상 실패 (다음 주기 재시도): user=${row.owner_user_id}`, e);
        }
    }
    return n;
}
