import SwiftUI
import OpenMakeKit

struct LumenDrawer: View {
    let sessions: [OpenMakeClient.SessionSummary]
    let email: String?
    let onDismiss: () -> Void
    let onNewChat: () -> Void
    let onAgentTasks: () -> Void
    let onDeepResearch: () -> Void
    let onConversation: (OpenMakeClient.SessionSummary) -> Void
    let onSettings: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Color.black.opacity(0.28)
                    .ignoresSafeArea()
                    .onTapGesture(perform: onDismiss)
                    .accessibilityLabel("메뉴 닫기")

                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            Wordmark(size: 22)
                            if let email {
                                Text(email)
                                    .font(.caption)
                                    .foregroundStyle(Lumen.muted)
                                    .lineLimit(1)
                            }
                        }
                        Spacer()
                        Button("메뉴 닫기", systemImage: "xmark", action: onDismiss)
                            .labelStyle(.iconOnly)
                            .frame(width: 44, height: 44)
                            .foregroundStyle(Lumen.fg2)
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 20)
                    .padding(.bottom, 16)

                    VStack(spacing: 4) {
                        DrawerRow(title: "새 대화", systemImage: "square.and.pencil", accent: true, action: onNewChat)
                        DrawerRow(title: "에이전트 작업", systemImage: "wand.and.stars", action: onAgentTasks)
                        DrawerRow(title: "딥리서치", systemImage: "magnifyingglass.circle", action: onDeepResearch)
                    }
                    .padding(.horizontal, 8)

                    Divider().overlay(Lumen.border).padding(.vertical, 12)

                    Text("최근 대화")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Lumen.muted)
                        .padding(.horizontal, 18)
                        .padding(.bottom, 6)

                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(sessions.prefix(20), id: \.id) { session in
                                DrawerRow(
                                    title: session.title,
                                    systemImage: "bubble.left",
                                    action: { onConversation(session) })
                            }
                        }
                        .padding(.horizontal, 8)
                    }

                    Divider().overlay(Lumen.border)
                    DrawerRow(title: "설정", systemImage: "gearshape", action: onSettings)
                        .padding(8)
                }
                .frame(width: min(proxy.size.width * 0.86, 360))
                .frame(maxHeight: .infinity)
                .background(Lumen.surface)
                .shadow(color: .black.opacity(0.18), radius: 24, x: 8)
                .gesture(
                    DragGesture(minimumDistance: 20)
                        .onEnded { value in
                            if value.translation.width < -60 { onDismiss() }
                        })
                .accessibilityAddTraits(.isModal)
            }
        }
        .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
        .zIndex(20)
    }
}

private struct DrawerRow: View {
    let title: String
    let systemImage: String
    var accent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 22)
                Text(title)
                    .font(.system(size: 15, weight: accent ? .semibold : .regular))
                    .lineLimit(1)
                Spacer()
            }
            .foregroundStyle(accent ? Lumen.accent : Lumen.fg2)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(accent ? Lumen.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
