// 업데이트 때 API key 넘겨받기(D-119) — 읽는 쪽.
// ad-hoc 서명은 빌드마다 앱 신원(cdhash)이 달라 새 버전이 옛 Keychain 항목을 창 없이 읽지 못한다.
// 업데이트하는 옛 버전(Updater 교체 스크립트)이 키를 이름 있는 파이프(FIFO)로 내주고, 새 버전이
// 첫 기동에 받아 자기 신원으로 다시 저장한다. 키는 디스크·인자·환경·로그 어디에도 남지 않는다.
import Darwin
import Foundation

enum KeyHandoff {
    /** 헬퍼의 device-id 와 같은 지원 폴더. 교체 스크립트도 이 경로를 쓴다(Updater 가 환경 OMK_KH 로 넘긴다). */
    static let path = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/OpenMakeCompanion/key-handoff").path

    /** 읽기 대기 합계 — 쓰는 쪽은 이미 FIFO 에서 기다리고 있어 보통 즉시 끝난다. 평상시(경로 없음)는 0. */
    private static let waitSeconds: Double = 3
    /** 읽기 상한 — 키(512바이트 이하)보다 넉넉하게, 그 이상은 버린다. */
    private static let readLimit = 4096
    /** 키 값 상한 — omk_live_* 는 훨씬 짧다. */
    private static let maxKeyBytes = 512

    /** 주 스레드에서 동기 호출 — `reconnectIfPossible()` 보다 먼저. */
    static func consume() {
        var st = stat()
        guard lstat(path, &st) == 0 else { return }
        defer { unlink(path) }
        guard (st.st_mode & S_IFMT) == S_IFIFO, st.st_uid == getuid(), (st.st_mode & 0o777) == 0o600 else { return }
        let fd = open(path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW)
        guard fd >= 0 else { return }
        defer { close(fd) }
        // lstat 과 open 사이에 바꿔치기됐으면 읽지 않는다.
        var fst = stat()
        guard fstat(fd, &fst) == 0, fst.st_dev == st.st_dev, fst.st_ino == st.st_ino else { return }

        var bytes = [UInt8]()
        var buf = [UInt8](repeating: 0, count: 1024)
        let deadline = Date().addingTimeInterval(waitSeconds)
        // macOS 의 FIFO 는 쓰는 쪽이 닫혀도 poll 이 POLLHUP 을 알리지 않는다(실측) — 그래서 먼저 read 로
        // 상태를 보고, poll 은 짧게 기다리는 데만 쓴다. read 0 = EOF(받은 게 있을 때) 또는 쓰는 쪽이 아직 안 열림.
        while true {
            let n = read(fd, &buf, buf.count)
            if n > 0 {
                bytes.append(contentsOf: buf[0..<n])
                if bytes.count > readLimit { return }
                continue
            }
            if n == 0, !bytes.isEmpty { break } // 쓰는 쪽이 닫음 = EOF
            if n < 0, errno != EAGAIN, errno != EINTR { return }
            let remainingMs = Int32(max(0, deadline.timeIntervalSinceNow * 1000))
            if remainingMs == 0 { return } // 시간 초과 — 받은 값은 쓰지 않는다
            var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            _ = poll(&pfd, 1, min(remainingMs, 50))
        }
        guard bytes.count <= maxKeyBytes, let key = String(bytes: bytes, encoding: .utf8),
              !key.isEmpty, key.unicodeScalars.allSatisfy({ $0.value > 0x20 && $0.value != 0x7F && !CharacterSet.whitespacesAndNewlines.contains($0) && !CharacterSet.controlCharacters.contains($0) })
        else { return }
        // 저장이 실패해도 이번 실행은 넘겨받은 키로 동작한다(다음 기동은 종전처럼 키체인 창).
        if !Keychain.save(key) { Keychain.remember(key) }
    }
}
