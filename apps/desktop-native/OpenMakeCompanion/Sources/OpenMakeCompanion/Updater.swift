// 자체 업데이터 — 서버 매니페스트(macos 블록 — UpdateChoice) 확인 → dmg 다운로드 → sha256 검증 →
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
                throw UpdateError.message(L("update.insecure"))
            }
            guard let url = URL(string: "\(backendUrl)/api/desktop/latest") else {
                throw UpdateError.message(L("update.badBackend"))
            }
            let (data, _) = try await URLSession.shared.data(from: url)
            let payload = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [String: Any]
            // 판단은 순수 함수(UpdateChoice) — macos 블록만 본다(plan-pr2.5 D-155).
            let block: UpdateBlock
            switch UpdateChoice.decide(payload: payload, current: currentVersion) {
            case .none:
                if interactive { info(L("update.none.title"), L("update.none.body", currentVersion)) }
                return
            case .latest:
                if interactive { info(L("update.latest.title"), L("update.latest.body", currentVersion)) }
                return
            case let .update(b):
                block = b
            }
            let version = block.version, file = block.file, sha256 = block.sha256
            // 교체는 앱 옆에 새 버전을 복사해 바꿔치기한다 — 그 폴더에 쓸 수 없으면(디스크 이미지에서 바로 실행 등) 받지 않고 안내만 한다.
            // 종전엔 내려받은 뒤 교체 스크립트가 "Read-only file system" 으로 실패했다(2026-10-05).
            guard canReplaceInPlace() else {
                info(L("update.readOnly.title", version, currentVersion), L("update.readOnly.body"))
                return
            }
            // 테스트 훅(개발/E2E 전용): 다이얼로그 없이 즉시 진행 — OMK_COMPANION_* env 훅 계열.
            if ProcessInfo.processInfo.environment["OMK_COMPANION_AUTO_UPDATE"] != "1" {
                let alert = NSAlert()
                alert.messageText = L("update.available.title", version, currentVersion)
                alert.informativeText = L("update.available.body")
                alert.addButton(withTitle: L("update.install"))
                alert.addButton(withTitle: L("update.later"))
                NSApp.activate(ignoringOtherApps: true)
                guard alert.runModal() == .alertFirstButtonReturn else { return }
            }

            let dmgURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(file)
            guard let dl = URL(string: "\(backendUrl)/api/desktop/download/\(file)") else {
                throw UpdateError.message(L("update.badDownload"))
            }
            let (tmp, _) = try await URLSession.shared.download(from: dl)
            try? FileManager.default.removeItem(at: dmgURL)
            try FileManager.default.moveItem(at: tmp, to: dmgURL)

            let digest = SHA256.hash(data: try Data(contentsOf: dmgURL))
            let hex = digest.map { String(format: "%02x", $0) }.joined()
            guard hex == sha256.lowercased() else {
                try? FileManager.default.removeItem(at: dmgURL)
                throw UpdateError.message(L("update.checksum"))
            }

            // 호스트를 먼저 끄고 exited 를 기다린다 — 교체 스크립트는 앱 종료를 기다리지 않고 2초 뒤 번들을 바꾸므로 그 안에 앱이
            // 끝나 있어야 한다. 스크립트의 키 파이프도 Rust 의 자식 띄우기와 겹치지 않는다(PR-3.2 D-233).
            await HelperManager.shared.stopHostAndWait()
            do {
                try spawnReplaceScript(dmgPath: dmgURL.path)
            } catch {
                // 앱이 끝나지 않으므로 끈 호스트를 되살리고 기존 실패 안내로 간다(D-233(r2)).
                HelperManager.shared.restartAfterUpdateFailure()
                throw error
            }
            NSApp.terminate(nil)
        } catch let e as UpdateError {
            if case let .message(m) = e, interactive { info(L("update.failed.title"), m) }
        } catch {
            if interactive { info(L("update.failed.title"), error.localizedDescription) }
        }
    }

    private func isSecureOrigin(_ s: String) -> Bool {
        guard let u = URL(string: s), let host = u.host else { return false }
        return u.scheme == "https" || host == "localhost" || host == "127.0.0.1"
    }

    /** 앱이 놓인 폴더에 쓸 수 있는가 — 읽기 전용 볼륨(dmg)·App Translocation 경로에서는 거짓. */
    private func canReplaceInPlace() -> Bool {
        let parent = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
        return FileManager.default.isWritableFile(atPath: parent)
    }

    /** 교체 스크립트가 실패 시 띄울 문구 — 앱이 다국어로 만들어 env 로 넘긴다(스크립트에 문자열을 박지 않음). */
    private static let scriptMessages: [String: String] = [
        "OMK_UPD_FAIL_TITLE": "update.script.failTitle",
        "OMK_UPD_LOG": "update.script.log",
        "OMK_UPD_MOUNT": "update.script.mount",
        "OMK_UPD_NO_APP": "update.script.noApp",
        "OMK_UPD_COPY": "update.script.copy",
        "OMK_UPD_REPLACE": "update.script.replace",
        "OMK_UPD_ROLLBACK": "update.script.rollback",
        "OMK_UPD_REOPEN": "update.script.reopen",
    ]

    /** 교체 스크립트 — Electron updater.js 의 검증된 시퀀스 이식 (스테이징→스왑→롤백·오류 시 osascript 경고). */
    private func spawnReplaceScript(dmgPath: String) throws {
        guard let appPath = Bundle.main.bundlePath.hasSuffix(".app") ? Bundle.main.bundlePath : nil else {
            throw UpdateError.message(L("update.noBundle"))
        }
        let ts = Int(Date().timeIntervalSince1970)
        let logPath = NSTemporaryDirectory() + "openmake-code-update-\(ts).log"
        let script = """
        #!/bin/bash
        exec >>"\(logPath)" 2>&1
        set -u
        # 앱이 stdin 으로 넘긴 API key(없으면 빈 줄) — 새 버전에 넘겨준다(D-119). 로그에 찍지 않는다(set -x·echo 금지).
        IFS= read -r -t 5 OMK_KEY || OMK_KEY=""
        APP="\(appPath)"
        DMG="\(dmgPath)"

        fail() {
          echo "FAIL: $1"
          /usr/bin/osascript -e "display alert \\"$OMK_UPD_FAIL_TITLE\\" message \\"$1\\n\\n$OMK_UPD_LOG: \(logPath)\\" as critical" || true
          [ -d "$APP" ] && open -a "$APP" || true
          rm -f "$DMG"
          exit 1
        }

        sleep 2
        MNT=$(hdiutil attach -nobrowse "$DMG" | grep -o '/Volumes/.*' | tail -1)
        [ -n "$MNT" ] || fail "$OMK_UPD_MOUNT"
        [ -d "$MNT/\(AppIdentity.appName).app" ] || { hdiutil detach "$MNT" -quiet; fail "$OMK_UPD_NO_APP"; }

        STAGE="$APP.new"
        rm -rf "$STAGE"
        if ! ditto "$MNT/\(AppIdentity.appName).app" "$STAGE"; then
          rm -rf "$STAGE"; hdiutil detach "$MNT" -quiet
          fail "$OMK_UPD_COPY"
        fi
        hdiutil detach "$MNT" -quiet

        BACKUP="$APP.old"
        rm -rf "$BACKUP"
        mv "$APP" "$BACKUP" || { rm -rf "$STAGE"; fail "$OMK_UPD_REPLACE"; }
        if ! mv "$STAGE" "$APP"; then
          mv "$BACKUP" "$APP" 2>/dev/null
          fail "$OMK_UPD_ROLLBACK"
        fi
        rm -rf "$BACKUP"

        xattr -dr com.apple.quarantine "$APP" 2>/dev/null
        rm -f "$DMG"
        # 키 넘겨주기: FIFO 는 디스크에 내용을 쓰지 않는다. 쓰는 쪽은 새 앱이 열 때까지 기다리고, 30초 뒤엔 끄고 지운다
        # (그 사이 못 받으면 종전처럼 키체인 창). 실패는 조용히 건너뛴다.
        KH="${OMK_KH:-}"
        if [ -n "$OMK_KEY" ] && [ -n "$KH" ]; then
          if mkdir -p "$(dirname "$KH")" 2>/dev/null && rm -f "$KH" && mkfifo -m 600 "$KH" 2>/dev/null; then
            ( printf '%s' "$OMK_KEY" > "$KH" ) 2>/dev/null &
            KH_PID=$!
            ( sleep 30; kill "$KH_PID" 2>/dev/null; rm -f "$KH" ) >/dev/null 2>&1 &
          fi
        fi
        OMK_KEY=""
        open -a "$APP" || fail "$OMK_UPD_REOPEN"
        echo "OK: updated $APP"
        rm -f "$0"
        """
        let shPath = NSTemporaryDirectory() + "openmake-code-update-\(ts).sh"
        try script.write(toFile: shPath, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: shPath)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [shPath]
        var env = ProcessInfo.processInfo.environment
        for (name, key) in Self.scriptMessages { env[name] = L(key) }
        env["OMK_KH"] = KeyHandoff.path // 경로는 비밀이 아니다 — 본문에 끼워 넣지 않아 셸 해석을 피한다.
        p.environment = env
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        // 키는 인자·환경이 아니라 stdin 파이프로만 준다(다른 프로세스가 읽을 수 있다 — 0.3.4 와 같은 이유).
        // 조회는 띄우기 전에 — 스크립트의 read 대기(5초)가 키체인 창 응답을 기다리지 않게.
        let keyLine = Data(((Keychain.load() ?? "") + "\n").utf8)
        let stdin = Pipe()
        p.standardInput = stdin
        try p.run() // detached 성격 — 부모 종료 후에도 계속 실행됨(스크립트가 sleep 후 교체)
        try? stdin.fileHandleForWriting.write(contentsOf: keyLine)
        try? stdin.fileHandleForWriting.close()
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
