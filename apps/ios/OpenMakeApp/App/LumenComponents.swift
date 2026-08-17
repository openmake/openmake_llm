import SwiftUI
import OpenMakeKit

struct ActivityStatusLine: View {
    let text: String
    var kind: ChatActivityKind = .preparing

    private var color: Color {
        switch kind {
        case .thinking:
            Lumen.warn
        case .agent, .research, .tool, .artifact:
            Lumen.accent
        case .preparing, .finalizing:
            Lumen.success
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            LumenDot(color: color, size: 6, pulsing: true)
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Lumen.muted)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
        .accessibilityAddTraits(.updatesFrequently)
        .transition(.opacity)
    }
}

/// 진행 카드 — 현재 단계 + 경과 시간 + 지나온 단계(펼치기) + 중단 버튼.
/// 상태 한 줄만으로는 "멈춘 것인지" 알 수 없다는 피드백(2026-08-17)에 대한 응답으로,
/// 경과 초를 1초마다 갱신해 살아있음을 보이고 이력으로 무엇을 했는지 남긴다.
struct ActivityProgressCard: View {
    let statusText: String
    let kind: ChatActivityKind
    let startedAt: Date?
    let log: [ChatActivityEntry]
    let onStop: () -> Void

    @State private var expanded = false

    private var color: Color {
        switch kind {
        case .thinking: Lumen.warn
        case .agent, .research, .tool, .artifact: Lumen.accent
        case .preparing, .finalizing: Lumen.success
        }
    }

    /// 이미 지나간 단계 (현재 단계 제외)
    private var pastEntries: [ChatActivityEntry] {
        log.count > 1 ? Array(log.dropLast().reversed()) : []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                LumenDot(color: color, size: 7, pulsing: true)

                Text(statusText)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Lumen.fg2)
                    .lineLimit(2)

                if let startedAt {
                    TimelineView(.periodic(from: startedAt, by: 1)) { context in
                        Text(elapsedText(now: context.date, from: startedAt))
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(Lumen.faint)
                            .monospacedDigit()
                    }
                }

                Spacer(minLength: 4)

                if !pastEntries.isEmpty {
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
                    } label: {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Lumen.faint)
                    }
                    .accessibilityLabel(expanded ? "진행 단계 접기" : "진행 단계 펼치기")
                }

                Button(action: onStop) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Lumen.muted)
                        .frame(width: 22, height: 22)
                        .background(Lumen.surface2, in: Circle())
                }
                .accessibilityLabel("응답 중단")
            }

            if expanded {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(pastEntries) { entry in
                        HStack(spacing: 7) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(Lumen.success)
                            Text(entry.text)
                                .font(.system(size: 11.5))
                                .foregroundStyle(Lumen.faint)
                                .lineLimit(1)
                        }
                    }
                }
                .padding(.leading, 2)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Lumen.border))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("진행 상태: \(statusText)")
    }

    private func elapsedText(now: Date, from start: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        if seconds < 60 { return "\(seconds)초" }
        return "\(seconds / 60)분 \(seconds % 60)초"
    }
}

struct ModeChip: View {
    let label: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .semibold))
            } else {
                LumenDot(size: 5)
            }
            Text(label)
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .semibold))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Lumen.accentSoft, in: Capsule())
        .foregroundStyle(Lumen.accent)
        .accessibilityElement(children: .combine)
        .accessibilityValue("켜짐")
    }
}

struct SkillChip: View {
    let name: String

    var body: some View {
        Label(name, systemImage: "sparkles")
            .font(.system(size: 11, weight: .medium))
            .lineLimit(1)
            .foregroundStyle(Lumen.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Lumen.surface2, in: Capsule())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("사용 스킬 \(name)")
    }
}

struct ActiveSkillBar: View {
    let skills: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(skills, id: \.self) { skill in
                    SkillChip(name: skill)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(Lumen.bg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("사용 스킬")
    }
}

#if DEBUG
struct DesignSystemShowcase: View {
    @State private var showDrawer = ProcessInfo.processInfo.environment["OPENMAKE_DESIGN_DRAWER"] == "1"
    @State private var selectedArtifact: ArtifactDocument?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Wordmark(size: 24)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("작업 상태")
                            .font(.headline)
                        ActivityStatusLine(text: "요청을 분석하고 있어요", kind: .preparing)
                        ActivityStatusLine(text: "웹에서 자료를 찾고 있어요", kind: .research)
                        ActivityStatusLine(text: "아티팩트를 만들고 있어요", kind: .artifact)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("활성 모드")
                            .font(.headline)
                        HStack {
                            ModeChip(label: "에이전트 작업", systemImage: "wand.and.stars")
                            ModeChip(label: "딥리서치", systemImage: "magnifyingglass.circle")
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("사용 스킬")
                            .font(.headline)
                        ActiveSkillBar(skills: ["web-search", "report", "artifact"])
                    }
                    AgentTaskCard(task: sampleTask, latestStep: sampleStep)
                    ArtifactCard(document: sampleArtifact) {
                        selectedArtifact = sampleArtifact
                    }
                    ArtifactCard(document: sampleHTMLArtifact) {
                        selectedArtifact = sampleHTMLArtifact
                    }
                }
                .padding(20)
            }
            .background(Lumen.bg)
            .navigationTitle("LUMEN")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("메뉴", systemImage: "line.3.horizontal") {
                        showDrawer = true
                    }
                }
            }
        }
        .sheet(item: $selectedArtifact) { artifact in
            ArtifactViewer(document: artifact)
        }
        .overlay {
            if showDrawer {
                LumenDrawer(
                    sessions: [],
                    email: "hello@openmake.cc",
                    onDismiss: { showDrawer = false },
                    onNewChat: { showDrawer = false },
                    onAgentTasks: { showDrawer = false },
                    onDeepResearch: { showDrawer = false },
                    onConversation: { _ in showDrawer = false },
                    onSettings: { showDrawer = false })
            }
        }
    }

    private var sampleTask: AgentTask {
        AgentTask(
            id: "showcase-task",
            goal: "공식 자료를 조사하고 핵심 결과를 정리해줘",
            status: .running,
            progress: 42,
            currentTurn: 3,
            maxTurns: 10)
    }

    private var sampleArtifact: ArtifactDocument {
        ArtifactDocument(
            id: "showcase",
            kind: "code",
            title: "Sample.swift",
            language: "swift",
            content: "let answer = 42",
            isComplete: true)
    }

    private var sampleHTMLArtifact: ArtifactDocument {
        ArtifactDocument(
            id: "showcase-html",
            kind: "html",
            title: "Research Summary.html",
            language: "html",
            content: "<h1>연구 요약</h1><p>공식 문서의 핵심 근거를 정리했습니다.</p>",
            isComplete: true)
    }

    private var sampleStep: AgentTaskStep {
        AgentTaskStep(
            id: 3,
            taskId: sampleTask.id,
            stepNumber: 3,
            stepType: "research",
            content: "공식 문서를 비교하고 핵심 근거를 정리하고 있어요",
            status: "running")
    }
}
#endif
