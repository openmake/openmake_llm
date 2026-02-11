import * as path from 'path';

// Import UserSandbox and createUserContext
import { UserSandbox, createUserContext } from '../mcp/user-sandbox';

describe('UserSandbox', () => {
    // Get the actual USER_DATA_ROOT by calling getWorkDir and extracting the base path
    const getActualUserDataRoot = (): string => {
        const workDir = UserSandbox.getWorkDir('test-user-id');
        // workDir is like: /path/to/data/users/test-user-id/workspace
        // We need to extract: /path/to/data/users
        return path.resolve(workDir, '..', '..');
    };

    const TEST_USER_DATA_PATH = getActualUserDataRoot();

    describe('getWorkDir(userId)', () => {
        it('should return correct workspace path for string userId', () => {
            const result = UserSandbox.getWorkDir('1');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '1', 'workspace'));
        });

        it('should return correct workspace path for number userId', () => {
            const result = UserSandbox.getWorkDir(1);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '1', 'workspace'));
        });

        it('should handle large userId numbers', () => {
            const result = UserSandbox.getWorkDir(999999);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '999999', 'workspace'));
        });

        it('should handle string userId with special characters', () => {
            const result = UserSandbox.getWorkDir('user-123');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, 'user-123', 'workspace'));
        });
    });

    describe('getDataDir(userId)', () => {
        it('should return correct data directory path for string userId', () => {
            const result = UserSandbox.getDataDir('1');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '1', 'data'));
        });

        it('should return correct data directory path for number userId', () => {
            const result = UserSandbox.getDataDir(1);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '1', 'data'));
        });

        it('should handle large userId numbers', () => {
            const result = UserSandbox.getDataDir(999999);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '999999', 'data'));
        });

        it('should handle string userId with special characters', () => {
            const result = UserSandbox.getDataDir('user-123');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, 'user-123', 'data'));
        });
    });

    describe('getTempDir(userId)', () => {
        it('should return correct temp directory path for string userId', () => {
            const result = UserSandbox.getTempDir('1');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '1', 'temp'));
        });

        it('should return correct temp directory path for number userId', () => {
            const result = UserSandbox.getTempDir(1);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '1', 'temp'));
        });

        it('should handle large userId numbers', () => {
            const result = UserSandbox.getTempDir(999999);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '999999', 'temp'));
        });

        it('should handle string userId with special characters', () => {
            const result = UserSandbox.getTempDir('user-123');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, 'user-123', 'temp'));
        });
    });

    describe('validatePath(userId, targetPath)', () => {
        it('should allow access to exact user root directory', () => {
            const userRoot = path.resolve(TEST_USER_DATA_PATH, '1');
            const result = UserSandbox.validatePath('1', userRoot);
            expect(result).toBe(true);
        });

        it('should allow access to files within user workspace', () => {
            const filePath = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'file.txt');
            const result = UserSandbox.validatePath('1', filePath);
            expect(result).toBe(true);
        });

        it('should allow access to nested files within user workspace', () => {
            const filePath = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'subdir', 'file.txt');
            const result = UserSandbox.validatePath('1', filePath);
            expect(result).toBe(true);
        });

        it('should allow access to user data directory', () => {
            const dataPath = path.resolve(TEST_USER_DATA_PATH, '1', 'data');
            const result = UserSandbox.validatePath('1', dataPath);
            expect(result).toBe(true);
        });

        it('should allow access to user temp directory', () => {
            const tempPath = path.resolve(TEST_USER_DATA_PATH, '1', 'temp');
            const result = UserSandbox.validatePath('1', tempPath);
            expect(result).toBe(true);
        });

        it('should BLOCK prefix attack: user 1 cannot access user 10 workspace', () => {
            // This is the critical security test for trailing separator defense
            const user10Path = path.resolve(TEST_USER_DATA_PATH, '10', 'workspace');
            const result = UserSandbox.validatePath('1', user10Path);
            expect(result).toBe(false);
        });

        it('should BLOCK prefix attack: user 1 cannot access user 10 root', () => {
            const user10Root = path.resolve(TEST_USER_DATA_PATH, '10');
            const result = UserSandbox.validatePath('1', user10Root);
            expect(result).toBe(false);
        });

        it('should BLOCK access to /etc/passwd', () => {
            const result = UserSandbox.validatePath('1', '/etc/passwd');
            expect(result).toBe(false);
        });

        it('should BLOCK access to /tmp directory', () => {
            const result = UserSandbox.validatePath('1', '/tmp');
            expect(result).toBe(false);
        });

        it('should BLOCK path traversal attack via ../', () => {
            const traversalPath = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', '..', '..', 'etc', 'passwd');
            const result = UserSandbox.validatePath('1', traversalPath);
            expect(result).toBe(false);
        });

        it('should BLOCK path traversal attack: ../../etc/passwd', () => {
            const traversalPath = path.resolve(TEST_USER_DATA_PATH, '1', '..', '..', 'etc', 'passwd');
            const result = UserSandbox.validatePath('1', traversalPath);
            expect(result).toBe(false);
        });

        it('should BLOCK access to parent directory', () => {
            const parentPath = path.resolve(TEST_USER_DATA_PATH, '1', '..');
            const result = UserSandbox.validatePath('1', parentPath);
            expect(result).toBe(false);
        });

        it('should BLOCK access to sibling user directory', () => {
            const siblingPath = path.resolve(TEST_USER_DATA_PATH, '2', 'workspace');
            const result = UserSandbox.validatePath('1', siblingPath);
            expect(result).toBe(false);
        });

        it('should handle number userId correctly', () => {
            const filePath = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'file.txt');
            const result = UserSandbox.validatePath(1, filePath);
            expect(result).toBe(true);
        });

        it('should handle string userId with special characters', () => {
            const userRoot = path.resolve(TEST_USER_DATA_PATH, 'user-123');
            const filePath = path.resolve(userRoot, 'workspace', 'file.txt');
            const result = UserSandbox.validatePath('user-123', filePath);
            expect(result).toBe(true);
        });

        it('should BLOCK access when userId is substring of target path', () => {
            // User "1" should not access "/tmp/test-sandbox-data/11/workspace"
            const user11Path = path.resolve(TEST_USER_DATA_PATH, '11', 'workspace');
            const result = UserSandbox.validatePath('1', user11Path);
            expect(result).toBe(false);
        });

        it('should BLOCK access when userId is substring of target path (user 2 vs 20)', () => {
            const user20Path = path.resolve(TEST_USER_DATA_PATH, '20', 'workspace');
            const result = UserSandbox.validatePath('2', user20Path);
            expect(result).toBe(false);
        });
    });

    describe('resolvePath(userId, inputPath)', () => {
        it('should resolve relative path against workspace directory', () => {
            const result = UserSandbox.resolvePath('1', 'file.txt');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'file.txt');
            expect(result).toBe(expected);
        });

        it('should resolve nested relative path against workspace directory', () => {
            const result = UserSandbox.resolvePath('1', 'subdir/file.txt');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'subdir', 'file.txt');
            expect(result).toBe(expected);
        });

        it('should resolve absolute valid path within user directory', () => {
            const validPath = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'file.txt');
            const result = UserSandbox.resolvePath('1', validPath);
            expect(result).toBe(validPath);
        });

        it('should return null for absolute invalid path outside user directory', () => {
            const result = UserSandbox.resolvePath('1', '/etc/passwd');
            expect(result).toBeNull();
        });

        it('should return null for path traversal attack via relative path', () => {
            const result = UserSandbox.resolvePath('1', '../../etc/passwd');
            expect(result).toBeNull();
        });

        it('should return null for path traversal attack with ../', () => {
            const result = UserSandbox.resolvePath('1', '../../../etc/passwd');
            expect(result).toBeNull();
        });

        it('should return null when trying to access sibling user directory', () => {
            // Relative path that tries to escape: ../../2/workspace/file.txt
            // This should resolve outside the user's workspace and be rejected
            const result = UserSandbox.resolvePath('1', '../../2/workspace/file.txt');
            expect(result).toBeNull();
        });

        it('should handle number userId correctly', () => {
            const result = UserSandbox.resolvePath(1, 'file.txt');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'file.txt');
            expect(result).toBe(expected);
        });

        it('should handle string userId with special characters', () => {
            const result = UserSandbox.resolvePath('user-123', 'file.txt');
            const expected = path.resolve(TEST_USER_DATA_PATH, 'user-123', 'workspace', 'file.txt');
            expect(result).toBe(expected);
        });

        it('should resolve absolute path to user data directory', () => {
            const dataPath = path.resolve(TEST_USER_DATA_PATH, '1', 'data', 'file.txt');
            const result = UserSandbox.resolvePath('1', dataPath);
            expect(result).toBe(dataPath);
        });

        it('should resolve absolute path to user temp directory', () => {
            const tempPath = path.resolve(TEST_USER_DATA_PATH, '1', 'temp', 'file.txt');
            const result = UserSandbox.resolvePath('1', tempPath);
            expect(result).toBe(tempPath);
        });

        it('should return null for absolute path to different user workspace', () => {
            const otherUserPath = path.resolve(TEST_USER_DATA_PATH, '2', 'workspace', 'file.txt');
            const result = UserSandbox.resolvePath('1', otherUserPath);
            expect(result).toBeNull();
        });

        it('should handle empty relative path', () => {
            const result = UserSandbox.resolvePath('1', '');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace');
            expect(result).toBe(expected);
        });

        it('should handle dot relative path', () => {
            const result = UserSandbox.resolvePath('1', '.');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace');
            expect(result).toBe(expected);
        });

        it('should handle relative path with multiple segments', () => {
            const result = UserSandbox.resolvePath('1', 'a/b/c/file.txt');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', 'a', 'b', 'c', 'file.txt');
            expect(result).toBe(expected);
        });
    });

    describe('createUserContext(userId, tier, role, orgId?)', () => {
        it('should create user context with all parameters', () => {
            const context = createUserContext('1', 'pro', 'admin', 'org-123');
            expect(context.userId).toBe('1');
            expect(context.tier).toBe('pro');
            expect(context.role).toBe('admin');
            expect(context.orgId).toBe('org-123');
        });

        it('should create user context without orgId', () => {
            const context = createUserContext('1', 'free', 'user');
            expect(context.userId).toBe('1');
            expect(context.tier).toBe('free');
            expect(context.role).toBe('user');
            expect(context.orgId).toBeUndefined();
        });

        it('should create user context with number userId', () => {
            const context = createUserContext(1, 'enterprise', 'admin', 'org-456');
            expect(context.userId).toBe(1);
            expect(context.tier).toBe('enterprise');
            expect(context.role).toBe('admin');
            expect(context.orgId).toBe('org-456');
        });

        it('should create user context with guest role', () => {
            const context = createUserContext('2', 'free', 'guest');
            expect(context.userId).toBe('2');
            expect(context.tier).toBe('free');
            expect(context.role).toBe('guest');
            expect(context.orgId).toBeUndefined();
        });

        it('should create user context with pro tier', () => {
            const context = createUserContext('3', 'pro', 'user', 'org-789');
            expect(context.userId).toBe('3');
            expect(context.tier).toBe('pro');
            expect(context.role).toBe('user');
            expect(context.orgId).toBe('org-789');
        });

        it('should create user context with enterprise tier', () => {
            const context = createUserContext('4', 'enterprise', 'admin');
            expect(context.userId).toBe('4');
            expect(context.tier).toBe('enterprise');
            expect(context.role).toBe('admin');
            expect(context.orgId).toBeUndefined();
        });

        it('should preserve all properties in returned context', () => {
            const context = createUserContext('test-user', 'pro', 'user', 'test-org');
            expect(Object.keys(context)).toContain('userId');
            expect(Object.keys(context)).toContain('tier');
            expect(Object.keys(context)).toContain('role');
            expect(Object.keys(context)).toContain('orgId');
        });

        it('should handle string userId with special characters', () => {
            const context = createUserContext('user-123-abc', 'free', 'guest');
            expect(context.userId).toBe('user-123-abc');
            expect(context.tier).toBe('free');
            expect(context.role).toBe('guest');
        });
    });

    describe('Security: Comprehensive Path Traversal Tests', () => {
        it('should prevent directory traversal with normalized paths', () => {
            const traversalPath = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace', '..', '..', '..', 'etc', 'passwd');
            const result = UserSandbox.validatePath('1', traversalPath);
            expect(result).toBe(false);
        });

        it('should prevent access to parent of user root', () => {
            const parentPath = path.resolve(TEST_USER_DATA_PATH, '1', '..');
            const result = UserSandbox.validatePath('1', parentPath);
            expect(result).toBe(false);
        });

        it('should prevent access to test-sandbox-data root', () => {
            const result = UserSandbox.validatePath('1', TEST_USER_DATA_PATH);
            expect(result).toBe(false);
        });

        it('should prevent access to filesystem root', () => {
            const result = UserSandbox.validatePath('1', '/');
            expect(result).toBe(false);
        });

        it('should prevent access to /home directory', () => {
            const result = UserSandbox.validatePath('1', '/home');
            expect(result).toBe(false);
        });

        it('should prevent access to /var directory', () => {
            const result = UserSandbox.validatePath('1', '/var');
            expect(result).toBe(false);
        });

        it('should prevent access to /usr directory', () => {
            const result = UserSandbox.validatePath('1', '/usr');
            expect(result).toBe(false);
        });

        it('should prevent access to /bin directory', () => {
            const result = UserSandbox.validatePath('1', '/bin');
            expect(result).toBe(false);
        });

        it('should prevent access to /opt directory', () => {
            const result = UserSandbox.validatePath('1', '/opt');
            expect(result).toBe(false);
        });

        it('should prevent access to /root directory', () => {
            const result = UserSandbox.validatePath('1', '/root');
            expect(result).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('should handle userId "0" correctly', () => {
            const result = UserSandbox.getWorkDir('0');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '0', 'workspace'));
        });

        it('should handle userId with leading zeros', () => {
            const result = UserSandbox.getWorkDir('001');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, '001', 'workspace'));
        });

        it('should handle very long userId', () => {
            const longUserId = 'a'.repeat(100);
            const result = UserSandbox.getWorkDir(longUserId);
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, longUserId, 'workspace'));
        });

        it('should handle userId with hyphens and underscores', () => {
            const result = UserSandbox.getWorkDir('user_123-abc');
            expect(result).toBe(path.resolve(TEST_USER_DATA_PATH, 'user_123-abc', 'workspace'));
        });

        it('should handle resolvePath with dot-dot at the end', () => {
            const result = UserSandbox.resolvePath('1', 'file.txt/..');
            const expected = path.resolve(TEST_USER_DATA_PATH, '1', 'workspace');
            expect(result).toBe(expected);
        });

        it('should handle validatePath with trailing slash', () => {
            const userRoot = path.resolve(TEST_USER_DATA_PATH, '1') + path.sep;
            const result = UserSandbox.validatePath('1', userRoot);
            expect(result).toBe(true);
        });

        it('should handle validatePath with multiple trailing slashes', () => {
            const userRoot = path.resolve(TEST_USER_DATA_PATH, '1') + path.sep + path.sep;
            const result = UserSandbox.validatePath('1', userRoot);
            expect(result).toBe(true);
        });
    });
});
