/**
 * MCP Filesystem Module Tests
 * 파일 경로 검증 및 확장자 검증 테스트
 */

// @ts-expect-error - bun:test types are built-in to bun runtime
import { describe, it, expect, mock } from 'bun:test';

// UserSandbox 모킹 (bun:test 호환)
mock.module('../mcp/user-sandbox', () => ({
    UserSandbox: {
        resolvePath: (userId: string | number, filePath: string) => {
            // 기본 동작: 단순 경로 반환 (테스트용)
            if (filePath.includes('..')) return null; // 경로 탈출 시도
            if (filePath.startsWith('/')) return filePath;
            return `/home/user${userId}/workspace/${filePath}`;
        }
    },
    UserContext: {}
}));

import { validateFilePath, isAllowedExtension } from '../mcp/filesystem';

describe('MCP Filesystem Module', () => {
    describe('validateFilePath', () => {
        it('should validate a simple relative path', () => {
            const result = validateFilePath(1, 'test.txt');

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe('/home/user1/workspace/test.txt');
            expect(result.error).toBeUndefined();
        });

        it('should validate an absolute path', () => {
            const result = validateFilePath(1, '/home/user1/workspace/file.md');

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe('/home/user1/workspace/file.md');
        });

        it('should reject path traversal attempts', () => {
            const result = validateFilePath(1, '../../../etc/passwd');

            expect(result.valid).toBe(false);
            expect(result.resolvedPath).toBeNull();
            expect(result.error).toBe('접근 권한이 없는 경로입니다');
        });

        it('should reject node_modules path', () => {
            const result = validateFilePath(1, 'node_modules/package.json');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('접근이 금지된 경로입니다');
        });

        it('should reject .git path', () => {
            const result = validateFilePath(1, '.git/config');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('접근이 금지된 경로입니다');
        });

        it('should reject .env file', () => {
            const result = validateFilePath(1, '.env');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('접근이 금지된 경로입니다');
        });

        it('should reject files with password in name', () => {
            const result = validateFilePath(1, 'my_password.txt');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('접근이 금지된 경로입니다');
        });

        it('should reject files with secret in name', () => {
            const result = validateFilePath(1, 'api_secret.json');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('접근이 금지된 경로입니다');
        });

        it('should reject files with credentials in name', () => {
            const result = validateFilePath(1, 'credentials.yaml');

            expect(result.valid).toBe(false);
            expect(result.error).toBe('접근이 금지된 경로입니다');
        });
    });

    describe('isAllowedExtension', () => {
        describe('allowed extensions', () => {
            const allowedExtensions = [
                '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
                '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
                '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h',
                '.sh', '.bash', '.zsh', '.fish',
                '.csv', '.log'
                // Note: .env.example은 path.extname이 .example을 반환하므로 별도 테스트
            ];

            allowedExtensions.forEach(ext => {
                it(`should allow ${ext} extension`, () => {
                    expect(isAllowedExtension(`file${ext}`)).toBe(true);
                });
            });
        });

        it('should allow files without extension', () => {
            expect(isAllowedExtension('Makefile')).toBe(true);
            expect(isAllowedExtension('Dockerfile')).toBe(true);
        });

        it('should deny binary extensions', () => {
            expect(isAllowedExtension('file.exe')).toBe(false);
            expect(isAllowedExtension('file.dll')).toBe(false);
            expect(isAllowedExtension('file.so')).toBe(false);
        });

        it('should deny image extensions', () => {
            expect(isAllowedExtension('image.png')).toBe(false);
            expect(isAllowedExtension('photo.jpg')).toBe(false);
            expect(isAllowedExtension('icon.gif')).toBe(false);
        });

        it('should be case insensitive', () => {
            expect(isAllowedExtension('FILE.TXT')).toBe(true);
            expect(isAllowedExtension('file.MD')).toBe(true);
            expect(isAllowedExtension('script.JS')).toBe(true);
        });
    });
});
