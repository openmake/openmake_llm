/**
 * 계약 패키지(@openmake/plugin-contracts) ↔ Base 타입·상수 호환 — 설계 3차 §3 C2.
 *
 * ① 타입 고정: `pin<…>()` 줄은 tsc(`npm run build`·`npx tsc --noEmit -p apps/api/tsconfig.json`)가 검사한다 —
 *    두 타입이 어긋나면 "Type 'false' does not satisfy the constraint 'true'"(TS2344)로 빌드가 실패한다.
 *    Jest 는 타입을 보지 않는다(tsconfig.jest.json isolatedModules).
 * ② 값 고정: Base 가 들고 있는 상수(API 는 계약 패키지를 런타임에 require 하지 않는다)가 계약 상수와 같은지(Jest).
 * ③ 의존 방향: Base 공개 계약 파일이 오케스트레이터·저장소 타입을 노출하지 않는지(Jest, 소스 문자열).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as contracts from '@openmake/plugin-contracts';
import type {
    AddonManifestDTO, AddonPermissionName, CapabilityAttachmentDTO, CapabilityExecContextDTO, CapabilityExecutorOutputDTO,
    CapabilityMediaDTO, CapabilityProgressEventDTO, CapabilityTaskDTO, CapabilityTaskResultDTO, CapabilityTaskStatus,
    CapabilityTaskUsageDTO,
} from '@openmake/plugin-contracts';
import type { Capability } from '../config/capabilities';
import type { AddonPermission } from '../config/addon-permissions';
import type { AddonManifest } from '../addon-host/manifest';
import type { PlanTask } from '../services/orchestrator/plan-schema';
import type {
    ExecContext, ExecutorOutput, OrchestratorAttachment, OrchestratorProgressEvent, TaskMedia, TaskResult, TaskStatus, TaskUsage,
} from '../services/orchestrator/types';
import { CAPABILITY_CONTRACT_VERSION, type CapabilityContext } from '../capability-contract/types';
import { ADDON_DESIRED_STATES, ADDON_FAILURE_CODES, ADDON_STATES } from '../data/repositories/addon-state-repository';
import { LOAD_SKILL_TOOL_NAME } from '../runtime-ports/skill-runtime';
import { TOOL_USER_INPUT_APPROVAL_NAME } from '../runtime-ports/tool-runtime';

type Equivalent<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** 타입 인자가 true 가 아니면 tsc 가 실패한다 — 런타임에는 아무것도 하지 않는다 */
function pin<T extends true>(): T | undefined { return undefined; }

// ── ① 오케스트레이터 실행 타입 ≡ 계약 DTO(Base capability 합집합으로 좁힌 것) ──
pin<Equivalent<PlanTask, CapabilityTaskDTO<Capability>>>();
pin<Equivalent<OrchestratorAttachment, CapabilityAttachmentDTO<Capability>>>();
pin<Equivalent<TaskMedia, CapabilityMediaDTO>>();
pin<Equivalent<TaskStatus, CapabilityTaskStatus>>();
pin<Equivalent<TaskUsage, CapabilityTaskUsageDTO>>();
pin<Equivalent<TaskResult, CapabilityTaskResultDTO<Capability>>>();
pin<Equivalent<OrchestratorProgressEvent, CapabilityProgressEventDTO<Capability>>>();
pin<Equivalent<Omit<ExecContext, 'targets' | 'handles'>, CapabilityExecContextDTO<Capability>>>();
pin<Equivalent<ExecutorOutput, CapabilityExecutorOutputDTO>>();
// handler 문맥은 계약 문맥을 그대로 품는다(Base 포트 필드만 더한다)
pin<CapabilityContext extends CapabilityExecContextDTO<Capability> ? true : false>();
// ── 매니페스트·권한 어휘 ──
pin<Equivalent<AddonManifest, AddonManifestDTO>>();
pin<Equivalent<AddonPermission, AddonPermissionName>>();

describe('Base 상수 ≡ 계약 상수', () => {
    it('add-on 상태·의도·실패 코드 어휘', () => {
        expect(ADDON_STATES).toEqual(contracts.ADDON_STATES);
        expect(ADDON_DESIRED_STATES).toEqual(contracts.ADDON_DESIRED_STATES);
        expect(ADDON_FAILURE_CODES).toEqual(contracts.ADDON_FAILURE_CODES);
    });

    it('capability 계약 버전·도구 이름', () => {
        expect(CAPABILITY_CONTRACT_VERSION).toBe(contracts.CAPABILITY_CONTRACT_VERSION);
        expect(LOAD_SKILL_TOOL_NAME).toBe(contracts.LOAD_SKILL_TOOL_NAME);
        expect(TOOL_USER_INPUT_APPROVAL_NAME).toBe(contracts.TOOL_USER_INPUT_APPROVAL_NAME);
    });

    it('계약 버전은 1.0.0', () => {
        expect(contracts.PLUGIN_CONTRACT_VERSION).toBe('1.0.0');
    });
});

describe('Base 공개 계약 파일의 의존 방향', () => {
    const source = (rel: string): string => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

    it('capability-contract/types.ts 는 오케스트레이터 모듈을 import 하지 않는다', () => {
        expect(source('capability-contract/types.ts')).not.toMatch(/from '\.\.\/services\/orchestrator\//);
    });

    it('스킬 포트는 저장소 타입을 노출하지 않는다', () => {
        expect(source('runtime-ports/skill-runtime.ts')).not.toMatch(/from '\.\.\/data\/repositories\/skill-repository'|\bAgentSkill\b/);
    });

    it('부팅 절차는 설치 표 행이 아니라 계약 의도(AddonInstallationIntent)를 받는다', () => {
        const text = source('addon-host/index.ts');
        expect(text).not.toMatch(/AddonInstallationRow/);
        expect(text).toMatch(/AddonInstallationIntent/);
    });

    it('수명주기 타입은 계약 패키지에서 온다(facade 는 재수출과 판별 함수만)', () => {
        const text = source('addon-host/lifecycle-types.ts');
        expect(text).toMatch(/from '@openmake\/plugin-contracts'/);
        expect(text).not.toMatch(/export interface AddonRuntimeHandle/);
    });
});
