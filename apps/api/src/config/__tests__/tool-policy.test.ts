/**
 * 도구 정책 등급표(2단계) — 분류와 정책 매핑. 현행 승인 판정과의 동일성은 approval-gate.test 가 고정한다.
 */
import { classifyToolRisk, policyRequiresApproval } from '../tool-policy';

describe('classifyToolRisk', () => {
    it('샌드박스 도구를 등급으로 나눈다', () => {
        expect(classifyToolRisk('bash')).toBe('exec');
        expect(classifyToolRisk('python_execute')).toBe('exec');
        expect(classifyToolRisk('skill_run')).toBe('exec');
        expect(classifyToolRisk('browser')).toBe('network');
        expect(classifyToolRisk('grep_code')).toBe('read');
        expect(classifyToolRisk('terminate')).toBe('control');
        expect(classifyToolRisk('ask_human')).toBe('control');
        expect(classifyToolRisk('mcp_elicit')).toBe('control');
    });
    it('file_ops·str_replace_editor 는 인자로 갈린다', () => {
        expect(classifyToolRisk('file_ops', { op: 'read' })).toBe('read');
        expect(classifyToolRisk('file_ops', { op: 'tree' })).toBe('read');
        expect(classifyToolRisk('file_ops', { op: 'write' })).toBe('write');
        expect(classifyToolRisk('file_ops', { op: 'delete' })).toBe('destructive');
        expect(classifyToolRisk('file_ops', {})).toBe('write'); // 인자 미지 — 보수적으로 쓰기
        expect(classifyToolRisk('str_replace_editor', { command: 'view' })).toBe('read');
        expect(classifyToolRisk('str_replace_editor', { command: 'str_replace' })).toBe('write');
    });
    it('표 밖 도구(내장·MCP)는 external', () => {
        expect(classifyToolRisk('web_search')).toBe('external');
        expect(classifyToolRisk('notion::create_page')).toBe('external');
    });
});

describe('policyRequiresApproval', () => {
    it('none 은 아무것도, control 은 어느 정책에서도 승인 불요', () => {
        expect(policyRequiresApproval('none', 'exec')).toBe(false);
        expect(policyRequiresApproval('all', 'control')).toBe(false);
        expect(policyRequiresApproval('high-risk', 'control')).toBe(false);
    });
    it('all 은 control 제외 전부', () => {
        for (const r of ['read', 'write', 'destructive', 'exec', 'network', 'external'] as const) {
            expect(policyRequiresApproval('all', r)).toBe(true);
        }
    });
    it('high-risk 는 exec·network·destructive + 자격증명 쓰기', () => {
        expect(policyRequiresApproval('high-risk', 'exec')).toBe(true);
        expect(policyRequiresApproval('high-risk', 'network')).toBe(true);
        expect(policyRequiresApproval('high-risk', 'destructive')).toBe(true);
        expect(policyRequiresApproval('high-risk', 'write')).toBe(false);
        expect(policyRequiresApproval('high-risk', 'write', true)).toBe(true);
        expect(policyRequiresApproval('high-risk', 'read')).toBe(false);
        expect(policyRequiresApproval('high-risk', 'external')).toBe(false);
    });
});
