/** @type {import('jest').Config} */
module.exports = {
    // 기본 환경
    testEnvironment: 'node',
    
    // TypeScript 변환 설정
    preset: 'ts-jest',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            useESM: false,
            // 타입 검사는 tsc --noEmit에서 수행; Jest는 런타임 테스트에 집중
            // backend/api/dist/*.d.ts와 infrastructure/*.ts 간 declare global 충돌 방지
            diagnostics: false,
            tsconfig: {
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                skipLibCheck: true
            }
        }],
        // ESM-only 패키지 (uuid 등) JS 파일 변환
        'node_modules/uuid/.+\\.js$': ['ts-jest', {
            useESM: false,
            tsconfig: {
                allowJs: true,
                esModuleInterop: true
            }
        }]
    },
    
    // 테스트 파일 패턴
    testMatch: [
        '<rootDir>/backend/api/src/**/__tests__/**/*.test.ts',
        '<rootDir>/backend/api/src/**/*.test.ts',
        '<rootDir>/tests/unit/**/*.test.ts'
    ],
    
    // 제외 패턴
    // Playwright 테스트는 npx playwright test로 실행
    // auth.test.ts, unified-database.test.ts in tests/unit/: 아키텍처 변경(SQLite→PostgreSQL)으로 stale
    // → 최신 버전은 backend/api/src/__tests__/ 에 존재
    testPathIgnorePatterns: [
        '/node_modules/',
        '\\.d\\.ts$',
        '/dist/',
        '/build/',
        '/tests/e2e/',
        'tests/unit/__tests__/auth\\.test\\.ts$',
        'tests/unit/__tests__/unified-database\\.test\\.ts$'
    ],
    
    // 모듈 해석에서 dist 폴더 제외 (소스 .ts와 컴파일된 .d.ts 간 타입 충돌 방지)
    modulePathIgnorePatterns: [
        '<rootDir>/backend/api/dist/'
    ],
    
    // 모듈 파일 확장자
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    
    // 모듈 경로 alias
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/backend/api/src/$1'
    },
    
    // ESM 모듈 변환 제외 패턴
    transformIgnorePatterns: [
        '/node_modules/(?!(@modelcontextprotocol|uuid)/)'
    ],
    
    // 커버리지 설정
    collectCoverageFrom: [
        'backend/api/src/**/*.ts',
        'database/**/*.ts',
        '!**/*.d.ts',
        '!**/node_modules/**',
        '!**/dist/**'
    ],
    
    // 타임아웃
    testTimeout: 30000,
    
    // 상세 출력
    verbose: true,
    
    // 캐시 디렉토리
    cacheDirectory: '<rootDir>/.jest-cache'
};
