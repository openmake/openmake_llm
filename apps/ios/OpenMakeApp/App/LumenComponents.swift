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
