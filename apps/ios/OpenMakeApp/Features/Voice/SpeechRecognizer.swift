// 음성 입력 (폰 기능 3단계) — Speech framework 온디바이스/서버 전사.
//
// 컴포저 마이크 버튼: 탭 → 녹음·실시간 전사(draft 에 반영) → 다시 탭 → 종료.
// 전사 결과는 일반 텍스트로 기존 채팅 경로를 그대로 탄다(서버 변경 없음).
// 권한(마이크·음성인식) 거부 시 시작하지 않고 상태만 남긴다(fail-open — 타이핑은 그대로 가능).
import Foundation
import Speech
import AVFoundation

@MainActor
@Observable
final class SpeechRecognizer {
    enum State: Equatable {
        case idle
        case recording
        case denied      // 권한 거부 — 설정 앱 안내용
        case unavailable // 이 기기/로케일에서 인식 불가
    }

    private(set) var state: State = .idle
    /// 이번 세션의 실시간 전사 텍스트 (부분 결과 포함)
    private(set) var transcript: String = ""

    private let recognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    init(locale: Locale = Locale(identifier: "ko-KR")) {
        // 기기 언어가 한국어가 아니어도 서비스 주 사용 언어(ko) 우선, 실패 시 기기 로케일
        recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer()
    }

    var isRecording: Bool { state == .recording }

    /// 녹음 시작 — 권한 요청(마이크+음성인식) 후 오디오 엔진 가동.
    func start() async {
        guard state != .recording else { return }
        transcript = ""

        let speechAuth = await withCheckedContinuation { (cont: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        guard speechAuth == .authorized else { state = .denied; return }

        let micGranted = await AVAudioApplication.requestRecordPermission()
        guard micGranted else { state = .denied; return }

        guard let recognizer, recognizer.isAvailable else { state = .unavailable; return }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            audioEngine.prepare()
            try audioEngine.start()

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                    }
                    if error != nil || (result?.isFinal ?? false) {
                        self.stopEngineOnly()
                    }
                }
            }
            state = .recording
        } catch {
            stopEngineOnly()
            state = .unavailable
        }
    }

    /// 녹음 종료 — 최종 전사 텍스트를 반환한다.
    @discardableResult
    func stop() -> String {
        request?.endAudio()
        stopEngineOnly()
        state = .idle
        return transcript
    }

    private func stopEngineOnly() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
