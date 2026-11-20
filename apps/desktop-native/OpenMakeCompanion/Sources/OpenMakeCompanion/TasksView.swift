// 작업 창 내용(PR-3.3 D-254·D-255·§2.1) — 왼쪽 목록, 오른쪽 상세(상태·목표·폴더·격리·시각·오류·스텝 타임라인). 서버 값만 그리고
// 문구는 TaskDisplay 대응표·L(키). 읽기 전용(실행·승인·재개는 웹, 3.4·3.5 범위).
import AppKit
import OmkFfi
import SwiftUI

struct TasksView: View {
    @ObservedObject var model: TasksModel
    let openSettings: () -> Void

    var body: some View {
        NavigationSplitView {
            TaskListPane(model: model, openSettings: openSettings)
                .navigationSplitViewColumnWidth(min: 280, ideal: 320)
        } detail: {
            TaskDetailPane(model: model)
        }
    }
}

/** 상태 배지 — 값 → 문구·색(D-258). */
struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(TaskDisplay.text(TaskDisplay.statusLabel(status)))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }

    private var color: Color {
        switch TaskDisplay.statusTone(status) {
        case .accent: return .accentColor
        case .green: return .green
        case .red: return .red
        case .gray: return .secondary
        }
    }
}

/** 가운데 정렬 안내 한 덩어리(불러오는 중·빈 목록·오류). */
struct PaneMessage<Extra: View>: View {
    let text: String
    @ViewBuilder var extra: Extra

    var body: some View {
        VStack(spacing: 10) {
            Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center)
            extra
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension PaneMessage where Extra == EmptyView {
    init(text: String) { self.init(text: text) { EmptyView() } }
}

struct TaskListPane: View {
    @ObservedObject var model: TasksModel
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L("tasks.subtitle")).font(.caption).foregroundStyle(.secondary)
                if let t = model.lastRefreshed {
                    Text(L("tasks.lastRefreshed", t.formatted(Date.FormatStyle(date: .omitted, time: .standard)
                        .locale(TaskDisplay.appLocale))))
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Button { model.refresh() } label: { Image(systemName: "arrow.clockwise") }
                .help(L("tasks.refresh"))
                .keyboardShortcut("r", modifiers: .command)
                .disabled(model.list == .noKey)
        }
        .padding(10)
    }

    @ViewBuilder private var content: some View {
        switch model.list {
        case .noKey:
            PaneMessage(text: L("tasks.noKey")) { Button(L("tasks.openSettings")) { openSettings() } }
        case .loading:
            PaneMessage(text: L("tasks.loading"))
        case let .failed(kind):
            PaneMessage(text: TaskDisplay.text(TaskDisplay.errorPhrase(kind)))
        case let .loaded(rows) where rows.isEmpty:
            PaneMessage(text: L("tasks.empty"))
        case let .loaded(rows):
            List(selection: Binding(get: { model.selectedId }, set: { model.select($0) })) {
                ForEach(rows, id: \.id) { TaskListRow(row: $0).tag($0.id) }
            }
        }
    }
}

struct TaskListRow: View {
    let row: TaskRow

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                StatusBadge(status: row.status)
                Spacer()
                if let t = TaskDisplay.dateText(row.updatedAt, locale: TaskDisplay.appLocale) {
                    Text(t).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Text(goal).lineLimit(1).truncationMode(.tail)
            HStack(spacing: 8) {
                Text(TaskDisplay.text(TaskDisplay.folderLabel(row.folderRel))).lineLimit(1)
                if let b = TaskDisplay.listBranch(row.isolation) { Text("⎇ \(b)").lineLimit(1) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private var goal: String {
        guard let g = row.goal, !g.isEmpty else { return L("tasks.goal.empty") }
        return g
    }
}

struct TaskDetailPane: View {
    @ObservedObject var model: TasksModel

    var body: some View {
        switch model.detail {
        case .none:
            PaneMessage(text: L("tasks.selectPrompt"))
        case .loading:
            PaneMessage(text: L("tasks.loading"))
        case let .failed(kind):
            PaneMessage(text: TaskDisplay.text(TaskDisplay.errorPhrase(kind))) {
                if kind == .tooLarge, let id = model.selectedId { OpenInWebButton(taskId: id) }
            }
        case let .loaded(d):
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    TaskHeader(task: d.task)
                    Divider()
                    TaskTimeline(steps: d.steps)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

struct OpenInWebButton: View {
    let taskId: String

    var body: some View {
        Button(L("tasks.openInWeb")) {
            if let url = URL(string: HelperManager.shared.taskWebUrl(taskId)) { NSWorkspace.shared.open(url) }
        }
    }
}

struct TaskHeader: View {
    let task: TaskRow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                StatusBadge(status: task.status)
                Spacer()
                OpenInWebButton(taskId: task.id)
            }
            Text(goal).font(.title3).textSelection(.enabled)
            Text(L("tasks.folder", TaskDisplay.text(TaskDisplay.folderLabel(task.folderRel))))
                .foregroundStyle(.secondary)
            if let iso = TaskDisplay.isolationLabel(task.isolation) {
                Text(TaskDisplay.text(iso)).foregroundStyle(.secondary).textSelection(.enabled)
            }
            HStack(spacing: 16) {
                if let c = TaskDisplay.dateText(task.createdAt, locale: TaskDisplay.appLocale) { Text(L("tasks.created", c)) }
                if let u = TaskDisplay.dateText(task.updatedAt, locale: TaskDisplay.appLocale) { Text(L("tasks.updated", u)) }
            }
            .font(.caption).foregroundStyle(.secondary)
            if let e = task.error, !e.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("tasks.errorLabel")).font(.caption.weight(.semibold))
                    Text(TaskDisplay.clipped(e, stepType: "").text).textSelection(.enabled)
                }
                .foregroundStyle(.red)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private var goal: String {
        guard let g = task.goal, !g.isEmpty else { return L("tasks.goal.empty") }
        return g
    }
}

struct TaskTimeline: View {
    let steps: [StepRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("tasks.steps.title", steps.count)).font(.headline)
            if steps.isEmpty {
                Text(L("tasks.steps.empty")).foregroundStyle(.secondary)
            }
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(Array(steps.enumerated()), id: \.offset) { StepView(step: $0.element) }
            }
        }
    }
}

struct StepView: View {
    let step: StepRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text("#\(step.stepNumber)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Text(step.stepType) // 원문 배지 — 웹과 같이 번역하지 않는다
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Color.secondary.opacity(0.15), in: Capsule())
                if let tool = step.toolName { Text(tool).font(.caption.monospaced()) }
                Spacer()
                if let t = TaskDisplay.dateText(step.createdAt, locale: TaskDisplay.appLocale) {
                    Text(t).font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let c = step.content, !c.isEmpty {
                let shown = TaskDisplay.clipped(c, stepType: step.stepType)
                Text(shown.text)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 4))
                if shown.clipped { Text(L("tasks.steps.clipped")).font(.caption2).foregroundStyle(.secondary) }
            }
        }
    }
}
