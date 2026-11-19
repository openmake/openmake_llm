// 업데이트 판단 — `/api/desktop/latest` 의 data(plan §2.2) → 받을지(plan-pr2.5 D-155).
// 새 앱은 `macos` 블록만 읽는다 — `native`(옛 정체성)는 다리 몫이라 보지 않는다.
// 순수 함수: 네트워크는 부르는 쪽(Updater)이 하고 값으로 넘긴다.
import Foundation

struct UpdateBlock: Equatable {
    let version: String
    let file: String
    let sha256: String
}

enum UpdateChoice: Equatable {
    /** 읽을 수 있는 블록이 없다(매니페스트 없음 등). */
    case none
    /** 블록은 있으나 새 버전이 없다. */
    case latest
    /** 같은 정체성 업데이트. */
    case update(UpdateBlock)

    static func decide(payload: [String: Any]?, current: String) -> UpdateChoice {
        guard let b = block(payload?[AppIdentity.updateBlock]) else { return .none }
        return isNewer(b.version, than: current) ? .update(b) : .latest
    }

    /** 숫자 버전(교체 스크립트가 dmg 안 앱을 고른다), `OpenMake-Code-*.dmg`, sha256 64자 hex. */
    private static func block(_ raw: Any?) -> UpdateBlock? {
        guard let b = raw as? [String: Any], let version = b["version"] as? String, let file = b["file"] as? String,
              let sha256 = b["sha256"] as? String,
              version.range(of: #"^[0-9]+(\.[0-9]+)*$"#, options: .regularExpression) != nil,
              file.range(of: "^" + NSRegularExpression.escapedPattern(for: AppIdentity.filePrefix) + #"[A-Za-z0-9.-]+\.dmg$"#,
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
