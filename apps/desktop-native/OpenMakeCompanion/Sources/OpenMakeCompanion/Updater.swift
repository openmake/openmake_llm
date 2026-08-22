// 자체 업데이터 — 서버 매니페스트(native 채널) 확인 → dmg 다운로드 → sha256 검증 →
// 분리 프로세스가 앱 교체 + 재실행 (Electron updater.js 와 동일 흐름·동일 안전장치).
//
// 보안:
//  - 업데이트 확인은 HTTPS(또는 로컬호스트) 백엔드에서만 허용 (MITM 차단)
//  - sha256 필수 — 매니페스트에 없으면 거부 (ad-hoc 서명 배포의 무결성 검증 수단)
//  - 교체는 스테이징(.new) → 스왑 → 실패 시 롤백(.old) — 도중 실패에도 기존 앱 보존
import AppKit
import CryptoKit
import Foundation

@MainActor
final class Updater: ObservableObject {
    static let shared = Updater()

    @Published var checking = false

    private var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    /** 기동 5초 후 자동 확인 (Electron 관행 준수). 새 버전 있을 때만 다이얼로그. */
    func scheduleStartupCheck(backendUrl: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            Task { await self.check(backendUrl: backendUrl, interactive: false) }
        }
    }

    func check(backendUrl: String, interactive: Bool) async {
        guard !checking else { return }
        checking = true
        defer { checking = false }
        do {
            guard isSecureOrigin(backendUrl) else {
                throw UpdateError.message("업데이트는 HTTPS(또는 로컬호스트) 백엔드에서만 허용됩니다")
            }
            guard let url = URL(string: "\(backendUrl)/api/desktop/latest") else {
                throw UpdateError.message("잘못된 백엔드 주소")
            }
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let payload = root["data"] as? [String: Any],
                  let native = payload["native"] as? [String: Any],
                  let version = native["version"] as? String,
                  let file = native["file"] as? String,
                  let sha256 = native["sha256"] as? String, sha256.count == 64
            else {
                if interactive { info("업데이트 없음", "native 채널 배포가 아직 없거나 매니페스트가 없습니다. (현재 v\(currentVersion))") }
                return
            }
            guard isNewer(version, than: currentVersion) else {
                if interactive { info("최신 버전", "현재 v\(currentVersion) 가 최신입니다.") }
                return
            }
            // 테스트 훅(개발/E2E 전용): 다이얼로그 없이 즉시 진행 — OMK_COMPANION_* env 훅 계열.
            if ProcessInfo.processInfo.environment["OMK_COMPANION_AUTO_UPDATE"] != "1" {
                let alert = NSAlert()
                alert.messageText = "새 버전 v\(version) 이 있습니다 (현재 v\(currentVersion))"
                alert.informativeText = "지금 받아서 설치할까요? 설치 중 앱이 잠시 종료됐다가 다시 열립니다."
                alert.addButton(withTitle: "업데이트")
                alert.addButton(withTitle: "나중에")
                NSApp.activate(ignoringOtherApps: true)
                guard alert.runModal() == .alertFirstButtonReturn else { return }
            }

            let dmgURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(file)
            guard let dl = URL(string: "\(backendUrl)/api/desktop/download/\(file)") else {
                throw UpdateError.message("잘못된 다운로드 주소")
            }
            let (tmp, _) = try await URLSession.shared.download(from: dl)
            try? FileManager.default.removeItem(at: dmgURL)
            try FileManager.default.moveItem(at: tmp, to: dmgURL)

            let digest = SHA256.hash(data: try Data(contentsOf: dmgURL))
            let hex = digest.map { String(format: "%02x", $0) }.joined()
            guard hex == sha256.lowercased() else {
                try? FileManager.default.removeItem(at: dmgURL)
                throw UpdateError.message("다운로드 무결성 검증 실패(sha256 불일치)")
            }

            try spawnReplaceScript(dmgPath: dmgURL.path)
            HelperManager.shared.stopHelper()
            NSApp.terminate(nil)
        } catch let e as UpdateError {
            if case let .message(m) = e, interactive { info("업데이트 확인 실패", m) }
        } catch {
            if interactive { info("업데이트 확인 실패", error.localizedDescription) }
        }
    }

    private func isSecureOrigin(_ s: String) -> Bool {
        guard let u = URL(string: s), let host = u.host else { return false }
        return u.scheme == "https" || host == "localhost" || host == "127.0.0.1"
    }

    /** 단순 수치 버전 비교 (a > b) — 자리수 다르면 부족분 0 취급. */
    private func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /** 교체 스크립트 — Electron updater.js 의 검증된 시퀀스 이식 (스테이징→스왑→롤백·오류 시 osascript 경고). */
    private func spawnReplaceScript(dmgPath: String) throws {
        guard let appPath = Bundle.main.bundlePath.hasSuffix(".app") ? Bundle.main.bundlePath : nil else {
            throw UpdateError.message("앱 번들 경로를 찾지 못했습니다(개발 실행에서는 업데이트 불가)")
        }
        let ts = Int(Date().timeIntervalSince1970)
        let logPath = NSTemporaryDirectory() + "openmake-companion-update-\(ts).log"
        let script = """
        #!/bin/bash
        exec >>"\(logPath)" 2>&1
        set -u
        APP="\(appPath)"
        DMG="\(dmgPath)"

        fail() {
          echo "FAIL: $1"
          /usr/bin/osascript -e "display alert \\"업데이트 실패\\" message \\"$1\\n\\n로그: \(logPath)\\" as critical" || true
          [ -d "$APP" ] && open -a "$APP" || true
          rm -f "$DMG"
          exit 1
        }

        sleep 2
        MNT=$(hdiutil attach -nobrowse "$DMG" | grep -o '/Volumes/.*' | tail -1)
        [ -n "$MNT" ] || fail "디스크 이미지를 마운트하지 못했습니다."
        [ -d "$MNT/OpenMake Companion.app" ] || { hdiutil detach "$MNT" -quiet; fail "이미지 안에서 앱을 찾지 못했습니다."; }

        STAGE="$APP.new"
        rm -rf "$STAGE"
        if ! ditto "$MNT/OpenMake Companion.app" "$STAGE"; then
          rm -rf "$STAGE"; hdiutil detach "$MNT" -quiet
          fail "새 버전 복사에 실패했습니다(설치 폴더 권한을 확인하세요)."
        fi
        hdiutil detach "$MNT" -quiet

        BACKUP="$APP.old"
        rm -rf "$BACKUP"
        mv "$APP" "$BACKUP" || { rm -rf "$STAGE"; fail "기존 앱을 교체할 수 없습니다."; }
        if ! mv "$STAGE" "$APP"; then
          mv "$BACKUP" "$APP" 2>/dev/null
          fail "새 버전 설치에 실패해 이전 버전으로 되돌렸습니다."
        fi
        rm -rf "$BACKUP"

        xattr -dr com.apple.quarantine "$APP" 2>/dev/null
        rm -f "$DMG"
        open -a "$APP" || fail "업데이트는 됐지만 앱을 다시 열지 못했습니다."
        echo "OK: updated $APP"
        rm -f "$0"
        """
        let shPath = NSTemporaryDirectory() + "openmake-companion-update-\(ts).sh"
        try script.write(toFile: shPath, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: shPath)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [shPath]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run() // detached 성격 — 부모 종료 후에도 계속 실행됨(스크립트가 sleep 후 교체)
    }

    private func info(_ title: String, _ body: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = body
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }
}

enum UpdateError: Error { case message(String) }
