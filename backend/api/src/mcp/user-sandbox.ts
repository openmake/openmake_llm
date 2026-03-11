/**
 * ============================================================
 * UserSandbox - 사용자 데이터 격리 환경
 * ============================================================
 *
 * 각 사용자별로 독립된 작업 디렉토리를 제공하고,
 * 다른 사용자의 데이터에 접근하지 못하도록 격리합니다.
 *
 * @module mcp/user-sandbox
 * @description
 * - 사용자별 격리된 디렉토리 구조: workspace/, data/, temp/
 * - Path Traversal 공격 방어 (trailing separator 검사)
 * - 상대 경로 → 안전한 절대 경로 변환
 * - 사용자별 SQLite DB, 대화 DB, 설정 파일 경로 관리
 * - 사용자 데이터 삭제, 임시 파일 정리, 디스크 사용량 계산
 * - UserContext 인터페이스 정의 (MCP 요청 시 사용자 정보 전달)
 *
 * @security
 * - validatePath(): trailing separator 추가로 prefix 우회 공격 방지
 * - resolvePath(): 절대/상대 경로 모두 사용자 루트 내로 제한
 *
 * 디렉토리 구조:
 * ```
 * USER_DATA_ROOT/
 * └── {userId}/
 *     ├── workspace/    # 작업 디렉토리 (fs_read_file 등의 기준)
 *     ├── data/          # 사용자 DB 및 데이터 파일
 *     │   ├── user.db
 *     │   └── conversations.db
 *     ├── temp/          # 임시 파일 (자동 정리 대상)
 *     └── config.json    # 사용자 설정
 * ```
 */

import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

/** 사용자 데이터 루트 경로 (config에서 로드 — 지연 평가로 Bun 병렬 테스트 레이스 방어) */
function getUserDataRoot(): string {
    return getConfig().userDataPath ?? './data/users';
}
const logger = createLogger('UserSandbox');

/**
 * 사용자별 격리된 작업 환경 관리 클래스
 *
 * 모든 메서드가 static으로 정의되어 인스턴스 생성 없이 사용합니다.
 * 파일시스템 도구(filesystem.ts)와 UnifiedMCPClient에서 참조합니다.
 *
 * @class UserSandbox
 */
export class UserSandbox {
    /**
     * 사용자별 작업 디렉토리 경로 반환
     *
     * 파일시스템 도구의 상대 경로 기준점으로 사용됩니다.
     *
     * @param userId - 사용자 ID
     * @returns 절대 경로 (USER_DATA_ROOT/{userId}/workspace)
     */
    static getWorkDir(userId: string | number): string {
        return path.resolve(getUserDataRoot(), String(userId), 'workspace');
    }

    /**
     * 사용자별 데이터 디렉토리 경로 반환
     *
     * @param userId - 사용자 ID
     * @returns 절대 경로 (USER_DATA_ROOT/{userId}/data)
     */
    static getDataDir(userId: string | number): string {
        return path.resolve(getUserDataRoot(), String(userId), 'data');
    }

    /**
     * 사용자별 임시 파일 디렉토리 경로 반환
     *
     * @param userId - 사용자 ID
     * @returns 절대 경로 (USER_DATA_ROOT/{userId}/temp)
     */
    static getTempDir(userId: string | number): string {
        return path.resolve(getUserDataRoot(), String(userId), 'temp');
    }

    /**
     * 사용자 디렉토리 초기화 (존재하지 않으면 생성)
     *
     * workspace, data, temp 디렉토리를 recursive로 생성합니다.
     *
     * @param userId - 사용자 ID
     */
    static async initUserDirs(userId: string | number): Promise<void> {
        const dirs = [
            this.getWorkDir(userId),
            this.getDataDir(userId),
            this.getTempDir(userId)
        ];

        for (const dir of dirs) {
            await fs.promises.mkdir(dir, { recursive: true }).catch(() => { });
        }
    }

    /**
     * 경로 접근 권한 검증
     *
     * 사용자가 자신의 디렉토리 외부로 접근하려는 시도를 차단합니다.
     *
     * @param userId - 사용자 ID
     * @param targetPath - 검증할 대상 경로
     * @returns 접근 허용이면 true, 거부이면 false
     *
     * @security Path Traversal 공격 방어
     * - trailing separator 추가로 prefix 우회 차단
     * - 예: 사용자 "1"이 "/data/users/10" 접근 시도 차단
     * - 기존: "/data/users/10".startsWith("/data/users/1") = true (취약)
     * - 수정: "/data/users/10/".startsWith("/data/users/1/") = false (안전)
     */
    static validatePath(userId: string | number, targetPath: string): boolean {
        const userRoot = path.resolve(getUserDataRoot(), String(userId));
        const resolvedPath = path.resolve(targetPath);

        // 🔒 보안 강화: trailing separator 추가로 prefix 우회 방지
        // 예: 사용자 "1"의 userRoot = "/data/users/1"
        // 공격자가 "/data/users/10"에 접근 시도 시:
        // - 기존: "/data/users/10".startsWith("/data/users/1") = true (취약!)
        // - 수정: "/data/users/10/".startsWith("/data/users/1/") = false (안전!)
        const userRootWithSep = userRoot + path.sep;
        const resolvedPathWithSep = resolvedPath + path.sep;

        // 정확히 userRoot이거나 userRoot 하위 경로인지 확인
        const isExactMatch = resolvedPath === userRoot;
        const isSubPath = resolvedPathWithSep.startsWith(userRootWithSep);

        if (!isExactMatch && !isSubPath) {
            logger.warn(`⚠️ 경로 접근 거부: ${resolvedPath} (사용자: ${userId})`);
            return false;
        }

        return true;
    }

    /**
     * 사용자 경로를 안전한 절대 경로로 변환
     *
     * 절대 경로는 validatePath()로 검증, 상대 경로는 작업 디렉토리 기준으로 해석합니다.
     * 접근이 거부되면 null을 반환합니다.
     *
     * @param userId - 사용자 ID
     * @param inputPath - 변환할 경로 (절대 또는 상대)
     * @returns 안전한 절대 경로 또는 접근 거부 시 null
     */
    static resolvePath(userId: string | number, inputPath: string): string | null {
        // 절대 경로인 경우 검증
        if (path.isAbsolute(inputPath)) {
            return this.validatePath(userId, inputPath) ? inputPath : null;
        }

        // 상대 경로는 사용자 작업 디렉토리 기준
        const resolved = path.resolve(this.getWorkDir(userId), inputPath);
        return this.validatePath(userId, resolved) ? resolved : null;
    }

    /**
     * 사용자 디렉토리 정보 조회
     *
     * @param userId - 사용자 ID
     * @returns 디렉토리 경로들과 존재 여부
     */
    static getUserDirInfo(userId: string | number): {
        workDir: string;
        dataDir: string;
        tempDir: string;
        exists: boolean;
    } {
        const workDir = this.getWorkDir(userId);
        return {
            workDir,
            dataDir: this.getDataDir(userId),
            tempDir: this.getTempDir(userId),
            exists: fs.existsSync(workDir)
        };
    }

    /**
     * 사용자 임시 파일 정리
     *
     * temp 디렉토리 내의 모든 파일과 하위 디렉토리를 삭제합니다.
     *
     * @param userId - 사용자 ID
     */
    static async cleanupTempDir(userId: string | number): Promise<void> {
        const tempDir = this.getTempDir(userId);
        try {
            const files = await fs.promises.readdir(tempDir, { withFileTypes: true });
            for (const file of files) {
                const filePath = path.join(tempDir, file.name);
                if (file.isDirectory()) {
                    await fs.promises.rm(filePath, { recursive: true, force: true });
                } else {
                    await fs.promises.unlink(filePath);
                }
            }
            logger.info(`임시 파일 정리 완료: ${userId}`);
        } catch {
            // 디렉토리가 없거나 접근 불가한 경우 무시
        }
    }

    // ============================================
    // User-Specific SQLite DB
    // ============================================

    /**
     * 사용자별 SQLite DB 파일 경로 반환
     *
     * 각 사용자는 독립된 DB를 사용하여 데이터 격리합니다.
     * 디렉토리가 없으면 자동 생성합니다.
     *
     * @param userId - 사용자 ID
     * @returns DB 파일 절대 경로 (data/user.db)
     */
    static async getUserDbPath(userId: string | number): Promise<string> {
        // 디렉토리 초기화 (존재하지 않으면 생성)
        await this.initUserDirs(userId);
        return path.resolve(getUserDataRoot(), String(userId), 'data', 'user.db');
    }

    /**
     * 사용자별 대화 DB 파일 경로 반환
     *
     * @param userId - 사용자 ID
     * @returns DB 파일 절대 경로 (data/conversations.db)
     */
    static async getUserConversationDbPath(userId: string | number): Promise<string> {
        await this.initUserDirs(userId);
        return path.resolve(getUserDataRoot(), String(userId), 'data', 'conversations.db');
    }

    /**
     * 사용자별 설정 파일 경로 반환
     *
     * @param userId - 사용자 ID
     * @returns 설정 파일 절대 경로 (config.json)
     */
    static async getUserConfigPath(userId: string | number): Promise<string> {
        await this.initUserDirs(userId);
        return path.resolve(getUserDataRoot(), String(userId), 'config.json');
    }

    /**
     * 사용자 설정을 JSON 파일로 저장
     *
     * @param userId - 사용자 ID
     * @param config - 저장할 설정 객체
     */
    static async saveUserConfig(userId: string | number, config: Record<string, unknown>): Promise<void> {
        const configPath = await this.getUserConfigPath(userId);
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        logger.info(`설정 저장: ${userId}`);
    }

    /**
     * 사용자 설정을 JSON 파일에서 로드
     *
     * 파일이 없거나 읽기 실패 시 빈 객체를 반환합니다.
     *
     * @param userId - 사용자 ID
     * @returns 설정 객체 또는 빈 객체
     */
    static async loadUserConfig(userId: string | number): Promise<Record<string, unknown>> {
        const configPath = await this.getUserConfigPath(userId);
        try {
            const data = await fs.promises.readFile(configPath, 'utf-8');
            return JSON.parse(data) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    /**
     * 사용자 데이터 전체 삭제 (계정 삭제 시)
     *
     * 사용자 루트 디렉토리를 recursive로 삭제합니다.
     *
     * @param userId - 사용자 ID
     * @returns 성공이면 true, 실패이면 false
     */
    static async deleteUserData(userId: string | number): Promise<boolean> {
        const userRoot = path.resolve(getUserDataRoot(), String(userId));
        try {
            await fs.promises.rm(userRoot, { recursive: true, force: true });
            logger.info(`사용자 데이터 삭제: ${userId}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 사용자 디스크 사용량 계산 (동기)
     *
     * 사용자 루트 디렉토리 내 모든 파일의 크기를 재귀적으로 합산합니다.
     *
     * @param userId - 사용자 ID
     * @returns 총 바이트 수 (디렉토리 미존재 시 0)
     */
    static getUserDiskUsage(userId: string | number): number {
        const userRoot = path.resolve(getUserDataRoot(), String(userId));
        if (!fs.existsSync(userRoot)) return 0;

        let totalSize = 0;
        const countSize = (dirPath: string) => {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    countSize(itemPath);
                } else {
                    totalSize += stat.size;
                }
            }
        };
        countSize(userRoot);
        return totalSize;
    }
}

/**
 * 사용자 컨텍스트 인터페이스
 *
 * MCP 도구 실행 시 서버에서 강제 주입하는 사용자 정보입니다.
 * MCPToolHandler의 두 번째 인자로 전달됩니다.
 *
 * @interface UserContext
 */
export interface UserContext {
    /** 사용자 고유 ID */
    userId: string | number;
    /** 도구 접근 등급 */
    tier: 'free' | 'pro' | 'enterprise';
    /** 사용자 역할 */
    role: 'admin' | 'user' | 'guest';
    /** 조직 ID (선택적, 멀티 테넌트용) */
    orgId?: string;
}

/**
 * 사용자 컨텍스트 팩토리 함수
 *
 * 서버 측에서만 호출하여 UserContext를 생성합니다.
 * 클라이언트에서의 직접 생성은 보안상 금지됩니다.
 *
 * @param userId - 사용자 고유 ID
 * @param tier - 도구 접근 등급
 * @param role - 사용자 역할
 * @param orgId - 조직 ID (선택적)
 * @returns 새 UserContext 객체
 */
export function createUserContext(
    userId: string | number,
    tier: 'free' | 'pro' | 'enterprise',
    role: 'admin' | 'user' | 'guest',
    orgId?: string
): UserContext {
    return { userId, tier, role, orgId };
}
