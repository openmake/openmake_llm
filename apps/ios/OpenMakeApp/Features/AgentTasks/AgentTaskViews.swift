import SwiftUI
import OpenMakeKit

struct AgentTaskCard: View {
    let task: AgentTask
    var latestStep: AgentTaskStep?
    var onOpen: (() -> Void)? = nil

    var body: some View {
        Group {
            if let onOpen {
                Button(action: onOpen) { cardContent }
                    .buttonStyle(.plain)
                    .accessibilityHint("작업 상세 열기")
            } else {
                cardContent
                    .accessibilityElement(children: .combine)
            }
        }
        .accessibilityLabel("\(task.goal), \(statusTitle)")
        .accessibilityValue("\(Int(task.progress))%")
    }

    private var cardContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                LumenDot(color: statusColor, size: 7, pulsing: isActive)
                Text(statusTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(statusColor)
                Spacer()
                Text("\(task.currentTurn)/\(task.maxTurns) 단계")
                    .font(.caption2)
                    .foregroundStyle(Lumen.muted)
            }
            Text(task.goal)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Lumen.fg)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            ProgressView(value: min(max(task.progress, 0), 100), total: 100)
                .tint(statusColor)
            if let detailText {
                Text(detailText)
                    .font(.caption)
                    .foregroundStyle(task.status == .failed ? .red : Lumen.muted)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Lumen.border))
    }

    private var isActive: Bool {
        [.pending, .queued, .running].contains(task.status)
    }

    private var statusTitle: String {
        switch task.status {
        case .pending: "준비 중"
        case .queued: "실행 대기"
        case .running: "작업 중"
        case .paused: "승인 대기"
        case .completed: "완료"
        case .failed: "실패"
        case .cancelled: "취소됨"
        }
    }

    private var statusColor: Color {
        switch task.status {
        case .completed: Lumen.success
        case .failed, .cancelled: .red
        case .paused: Lumen.warn
        default: Lumen.accent
        }
    }

    private var detailText: String? {
        if task.status == .failed { return task.error }
        if task.status == .completed { return task.result }
        return latestStep?.content
    }
}

struct AgentTaskListView: View {
    @Environment(AppModel.self) private var model
    @State private var tasks: [AgentTask] = []
    @State private var approvals: [AgentTaskApproval] = []
    @State private var showNewTask = false
    @State private var errorMessage: String?
    @State private var selectedTaskId: String?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !approvals.isEmpty {
                    Text("승인 대기")
                        .font(.headline)
                        .foregroundStyle(Lumen.fg)
                    ForEach(approvals) { approval in
                        AgentTaskApprovalCard(approval: approval) {
                            await load()
                        }
                    }
                }

                if tasks.isEmpty && errorMessage == nil {
                    ContentUnavailableView(
                        "에이전트 작업이 없습니다",
                        systemImage: "wand.and.stars",
                        description: Text("목표를 적으면 앱을 닫아도 서버에서 계속 작업합니다"))
                        .padding(.top, 80)
                } else {
                    ForEach(tasks) { task in
                        AgentTaskCard(task: task, latestStep: nil) {
                            selectedTaskId = task.id
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(Lumen.bg)
        .navigationTitle("에이전트 작업")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("새 작업", systemImage: "plus") {
                    showNewTask = true
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(12)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 12)
            }
        }
        .sheet(isPresented: $showNewTask) {
            NewAgentTaskSheet {
                await load()
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { selectedTaskId != nil },
            set: { if !$0 { selectedTaskId = nil } }
        )) {
            if let selectedTaskId {
                AgentTaskDetailView(taskId: selectedTaskId)
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                let hasActive = tasks.contains { [.pending, .queued, .running, .paused].contains($0.status) }
                do {
                    try await Task.sleep(for: .seconds(hasActive ? 2 : 8))
                } catch {
                    return
                }
            }
        }
    }

    private func load() async {
        do {
            async let taskRequest = model.client.agentTasks()
            async let approvalRequest = model.client.pendingAgentTaskApprovals()
            tasks = try await taskRequest
            approvals = (try? await approvalRequest) ?? []
            errorMessage = nil
        } catch {
            errorMessage = "작업 목록을 불러오지 못했습니다"
        }
    }
}

private struct NewAgentTaskSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var goal = ""
    @State private var policy = AgentTaskApprovalPolicy.highRisk
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    let onCreated: () async -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("목표") {
                    TextEditor(text: $goal)
                        .frame(minHeight: 130)
                }
                Section("도구 승인") {
                    Picker("정책", selection: $policy) {
                        Text("고위험만 확인").tag(AgentTaskApprovalPolicy.highRisk)
                        Text("항상 확인").tag(AgentTaskApprovalPolicy.all)
                        Text("자동 실행").tag(AgentTaskApprovalPolicy.none)
                    }
                    Text("고위험 작업은 실행 전에 에이전트 작업 화면에서 승인할 수 있습니다")
                        .font(.footnote)
                        .foregroundStyle(Lumen.muted)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("새 에이전트 작업")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("시작") {
                        Task { await submit() }
                    }
                    .disabled(goal.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
                }
            }
        }
    }

    private func submit() async {
        let trimmed = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let creation = try await model.client.createAgentTask(goal: trimmed)
            _ = try await model.client.executeAgentTask(id: creation.task.id, approvalPolicy: policy)
            await NotificationManager.shared.requestAuthorization()
            await onCreated()
            dismiss()
        } catch let error as OpenMakeAPIError {
            if case .server(_, _, let message) = error {
                errorMessage = message ?? "작업을 시작하지 못했습니다"
            } else {
                errorMessage = "작업을 시작하지 못했습니다"
            }
        } catch {
            errorMessage = "작업을 시작하지 못했습니다"
        }
    }
}

struct AgentTaskDetailView: View {
    let taskId: String
    @Environment(AppModel.self) private var model
    @State private var detail: AgentTaskDetail?
    @State private var approvals: [AgentTaskApproval] = []
    @State private var steering = ""
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let detail {
                    AgentTaskCard(task: detail.task, latestStep: detail.steps.last)

                    ForEach(approvals.filter { $0.taskId == taskId }) { approval in
                        AgentTaskApprovalCard(approval: approval) {
                            await load()
                        }
                    }

                    if let result = detail.task.result, !result.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("결과")
                                .font(.headline)
                            MarkdownText(content: result)
                        }
                    }

                    if !detail.steps.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("작업 기록")
                                .font(.headline)
                            ForEach(detail.steps.suffix(20)) { step in
                                HStack(alignment: .top, spacing: 8) {
                                    LumenDot(color: Lumen.faint, size: 5)
                                        .padding(.top, 6)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(step.toolName ?? step.stepType)
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(Lumen.fg2)
                                        if let content = step.content, !content.isEmpty {
                                            Text(content)
                                                .font(.caption)
                                                .foregroundStyle(Lumen.muted)
                                                .lineLimit(4)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if [.pending, .queued, .running, .paused].contains(detail.task.status) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("중간 지시")
                                .font(.headline)
                            HStack {
                                TextField("다음 단계에 반영할 내용", text: $steering)
                                    .textFieldStyle(.roundedBorder)
                                Button("보내기") {
                                    Task { await steer() }
                                }
                                .disabled(steering.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                            Button("작업 취소", role: .destructive) {
                                Task { await cancel() }
                            }
                        }
                    } else if detail.task.resumable {
                        Button("중단 지점에서 이어하기") {
                            Task { await resume() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else {
                    ProgressView("작업을 불러오고 있어요")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                }
            }
            .padding(16)
        }
        .background(Lumen.bg)
        .navigationTitle("작업 상세")
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .bottom) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(10)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 12)
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                let isActive = detail.map { [.pending, .queued, .running, .paused].contains($0.task.status) } ?? true
                do {
                    try await Task.sleep(for: .seconds(isActive ? 2 : 10))
                } catch {
                    return
                }
            }
        }
    }

    private func load() async {
        do {
            async let detailRequest = model.client.agentTask(id: taskId)
            async let approvalRequest = model.client.pendingAgentTaskApprovals()
            detail = try await detailRequest
            approvals = (try? await approvalRequest) ?? []
            errorMessage = nil
        } catch {
            errorMessage = "작업 상태를 불러오지 못했습니다"
        }
    }

    private func steer() async {
        let value = steering.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        do {
            try await model.client.steerAgentTask(id: taskId, message: value)
            steering = ""
        } catch {
            errorMessage = "지시를 보내지 못했습니다"
        }
    }

    private func cancel() async {
        do {
            try await model.client.cancelAgentTask(id: taskId)
            await load()
        } catch {
            errorMessage = "작업을 취소하지 못했습니다"
        }
    }

    private func resume() async {
        do {
            _ = try await model.client.resumeAgentTask(id: taskId)
            await load()
        } catch {
            errorMessage = "작업을 이어서 시작하지 못했습니다"
        }
    }
}

private struct AgentTaskApprovalCard: View {
    let approval: AgentTaskApproval
    let onResolved: () async -> Void
    @Environment(AppModel.self) private var model
    @State private var answer = ""
    @State private var isBusy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                approval.toolName == "ask_human" ? "에이전트 질문" : "도구 실행 승인",
                systemImage: approval.toolName == "ask_human" ? "questionmark.bubble" : "checkmark.shield")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Lumen.warn)
            Text(approval.toolName)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Lumen.muted)
            if approval.toolName == "ask_human" {
                TextField("에이전트에게 답변", text: $answer)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button("거절", role: .destructive) {
                        Task { await decide(approve: false) }
                    }
                    Spacer()
                    Button("답변 보내기") {
                        Task { await sendAnswer() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isBusy)
                }
            } else {
                HStack {
                    Button("거절", role: .destructive) {
                        Task { await decide(approve: false) }
                    }
                    Spacer()
                    Button("이후 자동 승인") {
                        Task { await autoApprove() }
                    }
                    Button("승인") {
                        Task { await decide(approve: true) }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .disabled(isBusy)
            }
        }
        .padding(14)
        .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Lumen.warn.opacity(0.5)))
    }

    private func decide(approve: Bool) async {
        isBusy = true
        defer { isBusy = false }
        try? await model.client.resolveAgentTaskApproval(id: approval.id, approve: approve)
        await onResolved()
    }

    private func sendAnswer() async {
        let value = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        isBusy = true
        defer { isBusy = false }
        try? await model.client.answerAgentTaskApproval(id: approval.id, text: value)
        await onResolved()
    }

    private func autoApprove() async {
        isBusy = true
        defer { isBusy = false }
        try? await model.client.autoApproveAgentTask(id: approval.taskId)
        await onResolved()
    }
}
