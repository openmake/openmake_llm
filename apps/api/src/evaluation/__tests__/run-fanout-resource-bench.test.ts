/**
 * fan-out 자원 벤치 CLI — 가짜 도구 런타임이 ToolRuntime 포트의 메서드를 빠짐없이 갖는지.
 * 포트에 메서드가 늘면(예: releaseUserToolsForTask) 벤치도 같이 따라와야 한다.
 */
import { benchRuntime } from '../run-fanout-resource-bench';
import { getToolRuntime, resetToolRuntime } from '../../runtime-ports/tool-runtime';

describe('run-fanout-resource-bench', () => {
    it('benchRuntime implements every ToolRuntime method', () => {
        resetToolRuntime();
        expect(Object.keys(benchRuntime).sort()).toEqual(Object.keys(getToolRuntime()).sort());
    });
});
