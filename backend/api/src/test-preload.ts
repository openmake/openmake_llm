/**
 * ============================================================
 * Test Preload Script - bun test 실행 전 환경변수 설정
 * ============================================================
 *
 * bun test의 preload로 사용되어 모든 테스트 파일보다 먼저 실행됩니다.
 * auth/index.ts 등 모듈 로드 시점에 필요한 환경변수를 미리 설정하여
 * "Unhandled error between tests" 문제를 방지합니다.
 *
 * @module test-preload
 */

// 테스트 환경에서 필수 환경변수 설정 (모듈 로드 전에 반드시 필요)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-purposes-only';
process.env.OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
process.env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://openmake:openmake_secret_2026@127.0.0.1:5432/openmake_llm';

// config 모듈을 미리 로드하여 싱글톤 캐시에 올바른 값 저장
// 이후 auth/index.ts 등이 getConfig()를 호출할 때 캐시된 값 사용
import { getConfig, resetConfig } from './config/env';

// 기존 캐시가 잘못된 값으로 초기화되었을 수 있으므로 리셋 후 재로드
resetConfig();
const config = getConfig();

if (!config.jwtSecret) {
    console.error('[test-preload] ❌ JWT_SECRET이 설정되지 않았습니다!');
} else {
    console.log('[test-preload] ✅ Config loaded, jwtSecret set');
}
