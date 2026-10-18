/**
 * add-on 의 DB 접근 문 — Base 와 **같은 풀·같은 재시도 래퍼**를 쓴다 (2026-10-18, MCP·스킬 저장 계층 이전).
 *
 * add-on 이 자기 소유 테이블(`config/addon-boundary.ts` `ADDON_OWNED_CORE_TABLES`, add-on 마이그레이션 테이블)을 다룰 때
 * `data/` 를 직접 import 하지 않고 이 문을 쓴다(add-on → Base 내부 import 래칫 `scripts/lint/addon-boundary-lib.mjs`).
 * 같은 DB·같은 풀의 코드 경계이며 물리 SQL 권한 격리를 주장하지 않는다. Base 테이블은 여기서 다루지 않고
 * `base-data-port.ts` 처럼 목적별 포트를 둔다.
 *
 * @module runtime-ports/db-access
 */
export { BaseRepository, type QueryParam } from '../data/repositories/base-repository';
export { getPool } from '../data/models/unified-database';
export { withRetry, withTransaction, type TransactionClient } from '../data/retry-wrapper';
