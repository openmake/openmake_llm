/** 코어 패키지 유닛 테스트 — 실 fs(tmpdir)·실 git·실 WS 서버로 보안 불변식을 검증한다. */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            // 패키지 tsconfig 는 __tests__ 를 빌드에서 제외하므로 테스트 컴파일 옵션은 여기서 준다.
            tsconfig: { target: 'ES2022', module: 'CommonJS', strict: true, esModuleInterop: true, types: ['node', 'jest'] },
        }],
    },
};
