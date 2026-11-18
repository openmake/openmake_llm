// 업데이트 판단 — `/api/desktop/latest` 의 data(plan §2.2) → 어느 쪽으로 갈지(plan-pr2.4 D-144·D-145·§3.2.1 단계 0).
// 순수 함수: 네트워크·UserDefaults·실행 중 앱 조회는 부르는 쪽(Updater)이 하고 값으로 넘긴다.
import Foundation

struct UpdateBlock: Equatable {
    let version: String
    let file: String
    let sha256: String
}

enum UpdateChoice: Equatable {
    /** 읽을 수 있는 블록이 없다(매니페스트 없음 등). */
    case none
    /** 블록은 있으나 새 버전이 없다(또는 실패했던 후속 버전을 자동 확인이 건너뛰었다). */
    case latest
    /** 종전 `native` 업데이트 — 0.4.3 과 같은 경로. */
    case sameIdentity(UpdateBlock)
    /** 후속 앱(OpenMake Code)으로 교체. */
    case successor(UpdateBlock)
    /** 후속 앱이 이미 실행 중 — 받지 않는다. 실패가 아니다(실패 버전으로 적지 않는다). */
    case successorRunning(UpdateBlock)

    static func decide(payload: [String: Any]?, current: String, interactive: Bool,
                       failedSuccessorVersion: String?, successorRunning: Bool) -> UpdateChoice {
        let native = sameIdentityBlock(payload?[AppIdentity.sameIdentityBlock])
        let successor = successorBlock(payload?[AppIdentity.successorBlock])

        // D-144: 후속 블록이 온전하고 더 높으면 후속 앱으로 바로 간다(native 가 함께 새 버전이어도).
        // D-145: 자동 확인은 실패했던 그 버전을 건너뛴다 — 수동 확인은 다시 시도, 더 높은 버전은 다시 권한다.
        if let s = successor, isNewer(s.version, than: current),
           interactive || s.version != failedSuccessorVersion {
            return successorRunning ? .successorRunning(s) : .successor(s)
        }
        if let n = native, isNewer(n.version, than: current) { return .sameIdentity(n) }
        return native == nil && successor == nil ? .none : .latest
    }

    /** 종전 Updater 의 native 판단 그대로 — version·file 문자열, sha256 64자. */
    private static func sameIdentityBlock(_ raw: Any?) -> UpdateBlock? {
        guard let b = raw as? [String: Any], let version = b["version"] as? String, let file = b["file"] as? String,
              let sha256 = b["sha256"] as? String, sha256.count == 64 else { return nil }
        return UpdateBlock(version: version, file: file, sha256: sha256)
    }

    /** 후속 블록은 더 좁게 본다 — 숫자 버전(스크립트가 dmg 안 버전과 글자로 견준다), `OpenMake-Code-*.dmg`, sha256 64자 hex. */
    private static func successorBlock(_ raw: Any?) -> UpdateBlock? {
        guard let b = raw as? [String: Any], let version = b["version"] as? String, let file = b["file"] as? String,
              let sha256 = b["sha256"] as? String,
              version.range(of: #"^[0-9]+(\.[0-9]+)*$"#, options: .regularExpression) != nil,
              file.range(of: "^" + NSRegularExpression.escapedPattern(for: AppIdentity.successorFilePrefix) + #"[A-Za-z0-9.-]+\.dmg$"#,
                         options: .regularExpression) != nil,
              sha256.range(of: #"^[0-9A-Fa-f]{64}$"#, options: .regularExpression) != nil
        else { return nil }
        return UpdateBlock(version: version, file: file, sha256: sha256)
    }

    /** 단순 수치 버전 비교 (a > b) — 자리수 다르면 부족분 0 취급. */
    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}
