/**
 * Unit tests for custom-builder path traversal protection
 * Tests sanitizeAgentId() and validatePathWithinDir()
 */

import * as path from 'path';
import { sanitizeAgentId, validatePathWithinDir } from '../custom-builder';

describe('sanitizeAgentId', () => {
    // Normal inputs
    it('should convert normal name to lowercase kebab-case', () => {
        expect(sanitizeAgentId('My Agent')).toBe('my-agent');
    });

    it('should allow simple alphanumeric names', () => {
        expect(sanitizeAgentId('agent1')).toBe('agent1');
    });

    it('should allow hyphens and underscores', () => {
        expect(sanitizeAgentId('my-agent_v2')).toBe('my-agent_v2');
    });

    it('should allow Korean characters', () => {
        const result = sanitizeAgentId('한국어에이전트');
        expect(result).toBe('한국어에이전트');
    });

    it('should collapse multiple hyphens', () => {
        expect(sanitizeAgentId('my---agent')).toBe('my-agent');
    });

    it('should trim leading and trailing hyphens', () => {
        expect(sanitizeAgentId('-agent-')).toBe('agent');
    });

    it('should limit length to 50 characters', () => {
        const longName = 'a'.repeat(100);
        expect(sanitizeAgentId(longName).length).toBeLessThanOrEqual(50);
    });

    // Path traversal attempts
    it('should strip ../ path traversal sequences', () => {
        const result = sanitizeAgentId('../../../etc/passwd');
        expect(result).not.toContain('..');
        expect(result).not.toContain('/');
    });

    it('should strip absolute path attempts', () => {
        const result = sanitizeAgentId('/etc/passwd');
        expect(result).not.toContain('/');
    });

    it('should strip backslash path traversal', () => {
        const result = sanitizeAgentId('..\\..\\windows\\system32');
        expect(result).not.toContain('\\');
        expect(result).not.toContain('..');
    });

    it('should strip special characters used in injection', () => {
        const result = sanitizeAgentId('agent;rm -rf /');
        expect(result).not.toContain(';');
        expect(result).not.toContain(' ');
    });

    it('should strip null bytes', () => {
        const result = sanitizeAgentId('agent\x00.md');
        expect(result).not.toContain('\x00');
    });

    it('should strip URL-encoded traversal', () => {
        const result = sanitizeAgentId('%2e%2e%2f%2e%2e%2f');
        // % gets stripped, dots get stripped
        expect(result).not.toContain('/');
        expect(result).not.toContain('%');
    });

    // Edge cases
    it('should throw on empty string', () => {
        expect(() => sanitizeAgentId('')).toThrow('Invalid agent name');
    });

    it('should throw on string that becomes empty after sanitization', () => {
        expect(() => sanitizeAgentId('...')).toThrow('Invalid agent name');
    });

    it('should throw on only special characters', () => {
        expect(() => sanitizeAgentId('!@#$%^&*()')).toThrow('Invalid agent name');
    });

    it('should handle mixed valid and invalid characters', () => {
        const result = sanitizeAgentId('my<script>agent');
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).toContain('my');
        expect(result).toContain('agent');
    });
});

describe('validatePathWithinDir', () => {
    const baseDir = '/tmp/test-prompts';

    // Valid paths
    it('should accept path within base directory', () => {
        expect(() => {
            validatePathWithinDir(path.join(baseDir, 'agent.md'), baseDir);
        }).not.toThrow();
    });

    it('should accept nested path within base directory', () => {
        expect(() => {
            validatePathWithinDir(path.join(baseDir, 'sub', 'agent.md'), baseDir);
        }).not.toThrow();
    });

    // Path traversal attacks
    it('should reject ../ traversal outside base directory', () => {
        expect(() => {
            validatePathWithinDir(path.join(baseDir, '..', 'etc', 'passwd'), baseDir);
        }).toThrow('Path traversal attempt detected');
    });

    it('should reject multiple ../ traversals', () => {
        expect(() => {
            validatePathWithinDir(path.join(baseDir, '..', '..', '..', 'etc', 'passwd'), baseDir);
        }).toThrow('Path traversal attempt detected');
    });

    it('should reject absolute path outside base directory', () => {
        expect(() => {
            validatePathWithinDir('/etc/passwd', baseDir);
        }).toThrow('Path traversal attempt detected');
    });

    it('should reject path that starts with base dir name but is different directory', () => {
        // e.g., baseDir is /tmp/test-prompts, attack path is /tmp/test-prompts-evil/file
        expect(() => {
            validatePathWithinDir(baseDir + '-evil/agent.md', baseDir);
        }).toThrow('Path traversal attempt detected');
    });

    it('should accept the base directory itself', () => {
        expect(() => {
            validatePathWithinDir(baseDir, baseDir);
        }).not.toThrow();
    });

    it('should handle relative base directory', () => {
        expect(() => {
            validatePathWithinDir('./data/../data/prompts/agent.md', './data/prompts');
        }).not.toThrow();
    });

    it('should reject relative traversal out of relative base', () => {
        expect(() => {
            validatePathWithinDir('./data/prompts/../../etc/passwd', './data/prompts');
        }).toThrow('Path traversal attempt detected');
    });
});
