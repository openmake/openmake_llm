// 채팅 세션 모델 (축 3 Step 4) — 이력 + WS 스트리밍 상태.
// 이벤트 축약은 Kit 의 ChatStreamState(단위 테스트됨), 여기는 화면 상태 배선만.
import Foundation
import Observation
import OpenMakeKit

@MainActor
@Observable
final class ChatSessionModel {
    private let client: OpenMakeClient
    private let socket: WsChatSocket
    private(set) var sessionId: String?

    private(set) var messages: [OpenMakeClient.ChatMessage] = []
    private(set) var streamingText = ""
    private(set) var isThinking = false
    private(set) var isStreaming = false
    private(set) var errorMessage: String?
    /// 오류가 아닌 안내 (중단 등) — 회색으로 표시
    private(set) var noticeText: String?
    /// 도구/리서치/토론 진행 한 줄 (ChatStreamState.statusText)
    private(set) var statusText: String?
    private(set) var activityKind: ChatActivityKind = .preparing
    private(set) var activeSkills: [String] = []
    private(set) var artifacts: [ArtifactDocument] = []
    private(set) var activeAgentTask: AgentTaskDetail?
    /// 이번 응답에서 지나온 단계 이력 — 진행 카드에서 펼쳐 본다
    private(set) var activityLog: [ChatActivityEntry] = []
    /// 스트리밍 시작 시각 — 경과 시간 표시(멈춤/진행 구분)의 기준
    private(set) var streamStartedAt: Date?

    init(client: OpenMakeClient, serverURL: URL, sessionId: String?) {
        self.client = client
        self.socket = WsChatSocket(serverURL: serverURL)
        self.sessionId = sessionId
    }

    func loadHistory() async {
        guard let sessionId else { return }
        do {
            messages = try await client.messages(sessionId: sessionId)
            artifacts = (try? await client.artifacts(sessionId: sessionId).map(ArtifactDocument.init(stored:))) ?? []
        } catch {
            errorMessage = "이력을 불러오지 못했습니다"
        }
    }

    func send(
        _ text: String,
        model: String? = nil,
        userAgentId: String? = nil,
        images: [String] = [],
        files: [WsAttachedFile] = [],
        modes: AppModel.ChatModes = .init(),
        userLocation: UserLocation? = nil
    ) async {
        errorMessage = nil
        noticeText = nil
        activeSkills = []
        messages.append(.init(
            role: .user, content: text, model: nil, tokens: nil,
            images: images.isEmpty ? nil : images, created_at: nil))

        if modes.agentTask {
            await startAgentTask(goal: text, images: images, files: files)
            return
        }

        isStreaming = true
        streamStartedAt = Date()
        defer {
            isStreaming = false
            streamStartedAt = nil
        }

        var state = ChatStreamState()
        // 첫 프레임까지 수십 초 걸리는 모드는 무엇을 기다리는지 알려준다
        state.begin(hint: modes.imageGen ? "이미지를 생성하고 있어요 (최대 1분)"
            : modes.deepResearch ? "자료를 조사하고 있어요"
            : modes.discussion ? "에이전트들이 토론을 준비하고 있어요"
            : nil)
        apply(state)

        do {
            guard let bearer = await client.accessToken else {
                errorMessage = "로그인이 필요합니다"
                return
            }
            // 연결이 없으면 (재)연결 — 스트림 종료 시 다음 send 에서 재연결 (plan: 재연결+이력 재조회 단순화)
            var events: AsyncStream<WsServerEvent>
            if await socket.isConnected, let current = currentEvents {
                events = current
            } else {
                events = try await socket.connect(bearer: bearer)
                currentEvents = events
            }

            let history = messages.dropLast().suffix(20).map {
                History(content: $0.content, role: ChatRole(rawValue: $0.role.rawValue) ?? .user)
            }
            try await socket.send(.chat(
                message: text,
                sessionId: sessionId,
                model: model,
                history: Array(history),
                images: images.isEmpty ? nil : images,
                files: files.isEmpty ? nil : files,
                webSearch: modes.webSearch ? true : nil,
                thinkingMode: modes.thinking ? true : nil,
                imageMode: modes.imageGen ? true : nil,
                artifactMode: modes.artifact ? true : nil,
                discussionMode: modes.discussion ? true : nil,
                deepResearchMode: modes.deepResearch ? true : nil,
                style: modes.style == .styleDefault ? nil : modes.style,
                userAgentId: userAgentId,
                userLocation: userLocation))

            // 앱 전환·백그라운드로 소켓이 끊기면 스트림이 done 없이 끝난다. 서버는 유예 동안 생성을
            // 계속하므로 재연결 후 resume 으로 이어받는다(웹 use-chat-socket 과 같은 규약).
            var resumeAttempts = 0
            streamLoop: while true {
                for await event in events {
                    state.apply(event)
                    apply(state)
                    if let sid = state.sessionId { sessionId = sid }
                    if state.needsTokenRefresh {
                        // 웹과 동일 규약: REST refresh — 다음 재연결이 새 토큰 사용
                        Task { try? await client.refresh() }
                    }
                    if state.isDone { break streamLoop }
                }
                guard resumeAttempts < Self.maxResumeAttempts else { break }
                resumeAttempts += 1
                statusText = "연결을 복구하고 있어요"
                try? await Task.sleep(for: .seconds(resumeAttempts))
                guard let bearer = await client.accessToken else { break }
                do {
                    events = try await socket.connect(bearer: bearer)
                    currentEvents = events
                    await socket.resume()
                } catch {
                    continue
                }
            }

            if let error = state.errorMessage {
                errorMessage = error
            } else if state.resumeUnavailable {
                noticeText = streamingText.isEmpty
                    ? "연결이 끊긴 사이 응답이 끝났어요. 대화 기록에서 확인해 주세요."
                    : "여기까지 받았고, 나머지는 대화 기록에 저장돼 있어요."
            } else if state.wasAborted {
                noticeText = streamingText.isEmpty
                    ? "응답을 중단했어요"
                    : "여기까지 받고 중단했어요"
            } else if !state.isDone {
                // done 없이 스트림이 끝남(연결 끊김·타임아웃) — 이전엔 메시지도 오류도 없이
                // 조용히 사라져 "응답이 오지 않는" 것처럼 보였다 (2026-08-17).
                errorMessage = streamingText.isEmpty
                    ? "응답이 중단됐어요. 다시 보내주세요."
                    : "응답이 중간에 끊겼어요. 이어서 다시 물어봐 주세요."
            }
            finalizeAssistantMessage()
            if modes.deepResearch, state.errorMessage == nil {
                await NotificationManager.shared.schedule(
                    title: "딥리서치 완료",
                    body: "요청하신 조사 결과가 준비되었습니다",
                    url: sessionId.map { "/chat/\($0)" })
            }
        } catch {
            errorMessage = "연결에 실패했습니다"
            finalizeAssistantMessage()
        }
    }

    /// 진행 중 응답 중단 — 서버에 abort 를 보내고 aborted 이벤트로 스트림이 닫힌다
    func stopStreaming() async {
        guard isStreaming else { return }
        statusText = "중단하고 있어요"
        await socket.abort()
    }

    func teardown() {
        agentPollTask?.cancel()
        Task { [socket] in await socket.disconnect() }
    }

    /// done 없이 스트림이 끝났을 때 재연결+resume 시도 횟수 상한
    private static let maxResumeAttempts = 3
    private var currentEvents: AsyncStream<WsServerEvent>?
    private var agentPollTask: Task<Void, Never>?

    private func apply(_ state: ChatStreamState) {
        streamingText = state.streamingText
        isThinking = state.isThinking
        statusText = state.statusText
        activityKind = state.activityKind ?? .preparing
        activeSkills = state.activeSkillNames
        activityLog = state.activityLog
        for artifact in state.artifacts {
            let document = ArtifactDocument(streamed: artifact)
            if let index = artifacts.firstIndex(where: { $0.id == document.id }) {
                artifacts[index] = document
            } else {
                artifacts.append(document)
            }
        }
    }

    private func startAgentTask(
        goal: String,
        images: [String],
        files: [WsAttachedFile]
    ) async {
        isStreaming = true
        statusText = "에이전트 작업을 만들고 있어요"
        activityKind = .agent
        defer { isStreaming = false }
        do {
            let creation = try await client.createAgentTask(
                goal: goal,
                files: files,
                images: images)
            activeAgentTask = AgentTaskDetail(task: creation.task, steps: [])
            let execution = try await client.executeAgentTask(id: creation.task.id)
            await NotificationManager.shared.requestAuthorization()
            statusText = execution.queued
                ? "에이전트 작업이 실행 대기 중이에요"
                : "에이전트가 첫 단계를 준비하고 있어요"
            agentPollTask?.cancel()
            agentPollTask = Task { [weak self] in
                await self?.pollAgentTask(id: creation.task.id)
            }
        } catch let error as OpenMakeAPIError {
            errorMessage = apiErrorText(error)
            statusText = nil
        } catch {
            errorMessage = "에이전트 작업을 시작하지 못했습니다"
            statusText = nil
        }
    }

    private func pollAgentTask(id: String) async {
        while !Task.isCancelled {
            do {
                let detail = try await client.agentTask(id: id)
                activeAgentTask = detail
                switch detail.task.status {
                case .completed, .failed, .cancelled:
                    statusText = nil
                    await NotificationManager.shared.notifyAgentTaskFinished(detail.task)
                    return
                case .paused:
                    statusText = "승인을 기다리고 있어요"
                case .queued:
                    statusText = "에이전트 작업이 실행 대기 중이에요"
                case .pending, .running:
                    if let latest = detail.steps.last?.content, !latest.isEmpty {
                        statusText = oneLine(latest)
                    } else {
                        statusText = "에이전트가 \(max(detail.task.currentTurn, 1))번째 단계를 진행하고 있어요"
                    }
                }
            } catch {
                errorMessage = "에이전트 작업 상태를 불러오지 못했습니다"
                return
            }
            do {
                try await Task.sleep(for: .seconds(2))
            } catch {
                return
            }
        }
    }

    private func oneLine(_ value: String) -> String {
        String(value
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .prefix(120))
    }

    private func apiErrorText(_ error: OpenMakeAPIError) -> String {
        if case .server(_, _, let message) = error, let message, !message.isEmpty {
            return message
        }
        return "에이전트 작업을 시작하지 못했습니다"
    }

    private func finalizeAssistantMessage() {
        if !streamingText.isEmpty {
            messages.append(.init(
                role: .assistant, content: streamingText,
                model: nil, tokens: nil, images: nil, created_at: nil))
        }
        streamingText = ""
        isThinking = false
        statusText = nil
    }
}
