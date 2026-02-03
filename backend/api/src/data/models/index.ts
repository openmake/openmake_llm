/**
 * Database Models Index
 * 
 * 🔒 아키텍처 개선: 중앙 집중화
 * 
 * ⚠️ 주의: 이 폴더는 향후 제거 예정입니다.
 * 모든 DB 모델은 /database/models에서 관리됩니다.
 * 
 * 마이그레이션 가이드:
 * 1. 새 코드에서는 'database/models'에서 직접 import
 * 2. 기존 코드는 이 파일을 통해 계속 접근 가능
 * 3. 추후 전체 마이그레이션 완료 시 이 폴더 제거
 * 
 * 예시:
 * // 기존 (deprecated)
 * import { getUnifiedDatabase } from '../data/models';
 * 
 * // 권장 (새 코드)
 * import { getUnifiedDatabase } from 'database/models';
 */

// 🔒 중앙 database/models에서 재-export
export { UnifiedDatabase, getUnifiedDatabase, getPool, closeDatabase } from './unified-database';
export { UserModel, type PublicUser, type CreateUserInput, type UserRole } from './user';
export { ConversationModel } from './conversation';

export type { User, ConversationSession, ConversationMessage } from './unified-database';
