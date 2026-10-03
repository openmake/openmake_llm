/**
 * 도구 정책 등급표(2단계) — 분류와 정책 매핑. 현행 승인 판정과의 동일성은 approval-gate.test 가 고정한다.
 */
import { classifyToolRisk, policyRequiresApproval, isThirdPartyTool } from '../tool-policy';

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
    it('high-risk 는 외부 MCP 서버 도구(thirdParty)도 승인 — none 은 그대로 자동', () => {
        expect(policyRequiresApproval('high-risk', 'external', false, true)).toBe(true);
        expect(policyRequiresApproval('none', 'external', false, true)).toBe(false);
    });
});

describe('isThirdPartyTool', () => {
    it('server::tool 이름만 외부 MCP 서버 도구로 본다', () => {
        expect(isThirdPartyTool('notion::create_page')).toBe(true);
        expect(isThirdPartyTool('web_search')).toBe(false);
        expect(isThirdPartyTool('bash')).toBe(false);
    });
});

describe('TOOL_RISK_OVERRIDES_JSON', () => {
    const prev = process.env.TOOL_RISK_OVERRIDES_JSON;
    afterEach(() => {
        if (prev === undefined) delete process.env.TOOL_RISK_OVERRIDES_JSON; else process.env.TOOL_RISK_OVERRIDES_JSON = prev;
        jest.resetModules();
        jest.dontMock('../../utils/logger');
    });
    function loadWith(raw: string): { warn: jest.Mock; classify: typeof classifyToolRisk } {
        const warn = jest.fn();
        process.env.TOOL_RISK_OVERRIDES_JSON = raw;
        jest.resetModules();
        jest.doMock('../../utils/logger', () => ({ createLogger: () => ({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));
        const mod = require('../tool-policy') as typeof import('../tool-policy');
        return { warn, classify: mod.classifyToolRisk };
    }
    it('깨진 JSON 은 표를 그대로 쓰되 경고를 남긴다', () => {
        const { warn, classify } = loadWith('{not json');
        expect(classify('bash')).toBe('exec');
        expect(warn).toHaveBeenCalledTimes(1);
    });
    it('모르는 등급은 버리고 어떤 도구인지 경고에 적는다', () => {
        const { warn, classify } = loadWith('{"bash":"harmless","browser":"read"}');
        expect(classify('bash')).toBe('exec');
        expect(classify('browser')).toBe('read');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('bash');
    });
    it('올바른 재정의에는 경고가 없다', () => {
        const { warn } = loadWith('{"browser":"read"}');
        expect(warn).not.toHaveBeenCalled();
    });
});
