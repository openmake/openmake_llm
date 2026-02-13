/**
 * 사용자 데이터 격리 (Sandbox)
 * 
 * 각 사용자별로 독립된 작업 디렉토리를 제공하고
 * 다른 사용자의 데이터에 접근하지 못하도록 격리합니다.
 */

import * as path from 'path';
import * as fs from 'fs';
import { getConfig } from '../config/env';

// 사용자 데이터 루트 경로
const USER_DATA_ROOT = getConfig().userDataPath;

/**
 * 사용자별 격리된 작업 환경
 */
export class UserSandbox {
    /**
     * 사용자별 작업 디렉토리 경로 반환
     */
    static getWorkDir(userId: string | number): string {
        return path.resolve(USER_DATA_ROOT, String(userId), 'workspace');
    }

    /**
     * 사용자별 데이터 디렉토리 경로 반환
     */
    static getDataDir(userId: string | number): string {
        return path.resolve(USER_DATA_ROOT, String(userId), 'data');
    }

    /**
     * 사용자별 임시 파일 디렉토리 경로 반환
     */
    static getTempDir(userId: string | number): string {
        return path.resolve(USER_DATA_ROOT, String(userId), 'temp');
    }

    /**
     * 사용자 디렉토리 초기화 (존재하지 않으면 생성)
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
     * 사용자가 자신의 디렉토리 외부로 접근하려는 시도를 차단
     * 
     * 🔒 보안 강화: Path Traversal 공격 방어
     * - 사용자 1이 /data/users/10 접근 방지 (prefix 우회 차단)
     * - 정규화된 경로 + trailing separator 검사
     */
    static validatePath(userId: string | number, targetPath: string): boolean {
        const userRoot = path.resolve(USER_DATA_ROOT, String(userId));
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
            console.warn(`[UserSandbox] ⚠️ 경로 접근 거부: ${resolvedPath} (사용자: ${userId})`);
            return false;
        }

        return true;
    }

    /**
     * 사용자 경로를 안전한 절대 경로로 변환
     * 상대 경로는 사용자 작업 디렉토리 기준으로 해석
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
            console.log(`[UserSandbox] 임시 파일 정리 완료: ${userId}`);
        } catch {
            // 디렉토리가 없거나 접근 불가한 경우 무시
        }
    }

    // ============================================
    // User-Specific SQLite DB
    // ============================================

    /**
     * 사용자별 SQLite DB 파일 경로 반환
     * 각 사용자는 독립된 DB를 사용하여 데이터 격리
     */
    static async getUserDbPath(userId: string | number): Promise<string> {
        // 디렉토리 초기화 (존재하지 않으면 생성)
        await this.initUserDirs(userId);
        return path.resolve(USER_DATA_ROOT, String(userId), 'data', 'user.db');
    }

    /**
     * 사용자별 대화 DB 파일 경로 반환
     */
    static async getUserConversationDbPath(userId: string | number): Promise<string> {
        await this.initUserDirs(userId);
        return path.resolve(USER_DATA_ROOT, String(userId), 'data', 'conversations.db');
    }

    /**
     * 사용자별 설정 파일 경로 반환
     */
    static async getUserConfigPath(userId: string | number): Promise<string> {
        await this.initUserDirs(userId);
        return path.resolve(USER_DATA_ROOT, String(userId), 'config.json');
    }

    /**
     * 사용자 설정 저장
     */
    static async saveUserConfig(userId: string | number, config: Record<string, unknown>): Promise<void> {
        const configPath = await this.getUserConfigPath(userId);
        await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[UserSandbox] 설정 저장: ${userId}`);
    }

    /**
     * 사용자 설정 로드
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
     */
    static async deleteUserData(userId: string | number): Promise<boolean> {
        const userRoot = path.resolve(USER_DATA_ROOT, String(userId));
        try {
            await fs.promises.rm(userRoot, { recursive: true, force: true });
            console.log(`[UserSandbox] 사용자 데이터 삭제: ${userId}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 사용자 디스크 사용량 계산
     */
    static getUserDiskUsage(userId: string | number): number {
        const userRoot = path.resolve(USER_DATA_ROOT, String(userId));
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
 * MCP 요청 시 서버에서 강제 주입
 */
export interface UserContext {
    userId: string | number;
    tier: 'free' | 'pro' | 'enterprise';
    role: 'admin' | 'user' | 'guest';
    orgId?: string;
}

/**
 * 사용자 컨텍스트 생성 (서버에서만 호출)
 */
export function createUserContext(
    userId: string | number,
    tier: 'free' | 'pro' | 'enterprise',
    role: 'admin' | 'user' | 'guest',
    orgId?: string
): UserContext {
    return { userId, tier, role, orgId };
}
