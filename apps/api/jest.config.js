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
        // tsconfig.jest.json(isolatedModules) → ts-jest 가 파일 단위 트랜스파일만 한다(타입 검사 없음).
        // 타입 검사를 켜 두면 워커가 TS 프로그램을 통째로 만들어(테스트 4건짜리 파일도 CPU ~11초)
        // workerIdleMemoryLimit 를 넘기고, 파일마다 워커가 재시작돼 그 비용을 매번 다시 치른다.
        // 테스트 파일의 타입 검사는 `npm run build`(tsc, src/**/* 포함)가 맡는다.
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }]
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
        // workspace 패키지의 **런타임** 해석을 소스로 직결한다(dist 없이도 require 가능).
        // 타입은 package.json 의 types(=dist/index.d.ts)로 해석되므로 tsc 타입 검사에는 dist 가
        // 있어야 한다(없으면 TS2307). (tsconfig paths 로 타입을 src 에 물리면 tsc 빌드가
        // rootDir 위반 TS6059 로 깨지므로 그 방법은 쓸 수 없다.)
        '^@openmake/config$': '<rootDir>/../../packages/config/src/index.ts',
        '^@openmake/api-client$': '<rootDir>/../../packages/api-client/src/index.ts',
        // ESM-only 패키지를 jest CJS 런타임에서 로드 가능하게 하는 로컬 shim.
        // 개별 테스트의 jest.mock(..., factory)은 그대로 우선 적용된다.
        '^uuid$': '<rootDir>/__mocks__/uuid.js',
        // @openai-oauth/core 는 ESM-only — 런타임(Node 24)은 require(esm) 로 로드하지만
        // jest CJS 런타임은 불가. 테스트는 provider 의 transportFactory 주입으로 대체.
        '^@openai-oauth/core$': '<rootDir>/__mocks__/empty.js',
        '^jsdom$': '<rootDir>/__mocks__/empty.js',
        '^@mozilla/readability$': '<rootDir>/__mocks__/empty.js',
        '^turndown$': '<rootDir>/__mocks__/empty.js',
        '^turndown-plugin-gfm$': '<rootDir>/__mocks__/empty.js'
    },
    setupFiles: ['<rootDir>/jest.setup.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.ts'],
    testTimeout: 10000,
    verbose: true,
    // Worker 메모리 제한 + 강제 종료 — worker leak 경고 해소
    workerIdleMemoryLimit: '512MB',
    // 16GB 머신에서 기본 워커(ncpu-1=9개) 병렬 실행 시 메모리 고갈 → WindowServer 워치독 패닉 발생
    maxWorkers: 2,
    forceExit: true
};
