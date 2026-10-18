/**
 * user_extensions 권한 상태 저장 (190) + 권한 변화를 연결된 MCP 서버에 반영.
 *
 * - savePermissionState: 설치·업데이트(ingest)가 판정 결과를 저장한다. reviewedBy 가 null 이면 승인 기록(by·at)은 그대로 둔다.
 * - saveReviewIfRequestedUnchanged: 재승인·철회. 읽은 요청 권한과 저장된 값이 같을 때만 쓴다 — 그 사이 업데이트가
 *   요청을 넓혔으면 0행(null)을 돌려 호출부가 409 로 알린다(오래된 화면으로 넓어진 권한을 승인하지 않는다).
 * - restrictLinkedMcpNetwork / restoreLinkedMcpNetwork: 네트워크 권한이 닫히거나 열릴 때 연결된 mcp_servers 를 고친다.
 *   manifest_meta 표시(networkRestrictedByPermission·disabledByPermission)로 "권한 때문에 바꾼 것"만 되돌린다.
 *   이미 떠 있는 MCP 프로세스는 바꾸지 않는다 — 다음 기동부터 적용된다.
 *
 * jsonb 파라미터는 배열이면 JSON 문자열, null 이면 SQL NULL 로 보낸다(JSON.stringify(null) 은 jsonb 'null' 이 된다).
 *
 * @module data/repositories/user-extension-permission-repository
 */
import { getComponentStore } from '../../addon-host/addon-data';
import { BaseRepository } from './base-repository';
import type { UserExtensionRow } from './user-extension-repository';
import type { ExtensionPermissionState } from '../../config/addon-permissions';

export interface SavePermissionStateInput {
    state: ExtensionPermissionState;
    granted: readonly string[] | null;
    requested: readonly string[] | null;
    /** 새 승인 기록을 남길 사용자 id. null 이면 permissions_reviewed_by·at 을 바꾸지 않는다 */
    reviewedBy: string | null;
}

export interface SaveReviewInput {
    state: ExtensionPermissionState;
    granted: readonly string[] | null;
    /** 승인·철회한 사용자 id */
    reviewedBy: string;
    /** 판정에 쓴 요청 권한 — 저장된 값이 이와 다르면 쓰지 않는다 */
    expectedRequested: readonly string[] | null;
}

/** jsonb 파라미터 — null 은 SQL NULL, 배열은 JSON 문자열 */
export function jsonbParam(value: readonly string[] | null): string | null {
    return value === null ? null : JSON.stringify(value);
}

export class UserExtensionPermissionRepository extends BaseRepository {
    async savePermissionState(id: string, input: SavePermissionStateInput): Promise<UserExtensionRow | null> {
        const r = await this.query<UserExtensionRow>(
            `UPDATE user_extensions
                SET permission_state = $2,
                    permissions_granted = $3::jsonb,
                    permissions_requested = $4::jsonb,
                    permissions_reviewed_by = COALESCE($5::text, permissions_reviewed_by),
                    permissions_reviewed_at = CASE WHEN $5::text IS NULL THEN permissions_reviewed_at ELSE NOW() END,
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [id, input.state, jsonbParam(input.granted), jsonbParam(input.requested), input.reviewedBy],
        );
        return r.rows[0] ?? null;
    }

    async saveReviewIfRequestedUnchanged(id: string, input: SaveReviewInput): Promise<UserExtensionRow | null> {
        const r = await this.query<UserExtensionRow>(
            `UPDATE user_extensions
                SET permission_state = $2,
                    permissions_granted = $3::jsonb,
                    permissions_reviewed_by = $4,
                    permissions_reviewed_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
                AND status = 'active'
                AND permissions_requested IS NOT DISTINCT FROM $5::jsonb
              RETURNING *`,
            [id, input.state, jsonbParam(input.granted), input.reviewedBy, jsonbParam(input.expectedRequested)],
        );
        return r.rows[0] ?? null;
    }

    /** 네트워크 권한이 닫혔다 — stdio 는 --network none, 원격(HTTP)은 끈다. 이미 none·꺼진 서버는 건드리지 않는다(MCP add-on 저장 연산) */
    async restrictLinkedMcpNetwork(extensionId: string): Promise<{ sandboxed: number; disabled: number }> {
        return getComponentStore('mcpServers', this.pool).restrictNetworkForExtension(extensionId);
    }

    /**
     * 네트워크 권한이 열렸다 — 권한 때문에 막았던 stdio 만 되돌린다(작성자가 처음부터 none 으로 둔 서버는 그대로).
     * 권한 때문에 끈 원격 서버는 켜지 않는다 — 켜기는 사용자의 MCP 승인 행위다.
     */
    async restoreLinkedMcpNetwork(extensionId: string): Promise<number> {
        return getComponentStore('mcpServers', this.pool).restoreNetworkForExtension(extensionId);
    }
}
