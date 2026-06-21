/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/__tests__/**/*.spec.ts',
        '**/*.test.ts',
        '**/*.spec.ts'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
    ],
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/cli.ts'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        // ESM-only 패키지를 jest CJS 런타임에서 로드 가능하게 하는 로컬 shim.
        // 개별 테스트의 jest.mock(..., factory)은 그대로 우선 적용된다.
        '^uuid$': '<rootDir>/__mocks__/uuid.js',
        '^jsdom$': '<rootDir>/__mocks__/empty.js',
        '^@mozilla/readability$': '<rootDir>/__mocks__/empty.js',
        '^turndown$': '<rootDir>/__mocks__/empty.js',
        '^turndown-plugin-gfm$': '<rootDir>/__mocks__/empty.js'
    },
    setupFiles: ['<rootDir>/jest.setup.ts'],
    setupFilesAfterEnv: [],
    testTimeout: 10000,
    verbose: true,
    // Worker 메모리 제한 + 강제 종료 — worker leak 경고 해소
    workerIdleMemoryLimit: '512MB',
    forceExit: true
};
