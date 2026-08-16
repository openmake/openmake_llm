// 설정 시트 — 계정·응답 스타일·서버 정보·로그아웃
import SwiftUI
import OpenMakeKit

struct SettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var notifications = NotificationManager.shared

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            List {
                if case .loggedIn(let user) = model.authState {
                    Section("계정") {
                        LabeledContent("이메일", value: user.email)
                        LabeledContent("역할", value: user.role.rawValue)
                    }
                }

                Section("응답 스타일") {
                    Picker("스타일", selection: $model.modes.style) {
                        Text("간결").tag(Style.concise)
                        Text("기본").tag(Style.styleDefault)
                        Text("상세").tag(Style.verbose)
                    }
                    .pickerStyle(.segmented)
                }

                Section("서버") {
                    LabeledContent("주소", value: AppConfig.serverURL.host() ?? "-")
                    if let catalog = model.modelCatalog {
                        LabeledContent("기본 모델", value: catalog.defaultModel)
                    }
                }

                Section("알림") {
                    LabeledContent("상태", value: notifications.statusText)
                    Button(notifications.authorizationStatus == .notDetermined ? "알림 허용" : "알림 권한 다시 확인") {
                        Task { await notifications.requestAuthorization() }
                    }
                    if notifications.authorizationStatus == .authorized {
                        Button("테스트 알림 보내기") {
                            Task {
                                await notifications.schedule(
                                    title: "OpenMake 알림",
                                    body: "에이전트 작업과 딥리서치 완료를 알려드릴게요")
                            }
                        }
                    }
                    if !notifications.remotePushEnabled {
                        Text("현재 서명은 로컬 알림 모드입니다. Apple Push capability를 활성화하면 원격 푸시 등록을 켤 수 있습니다.")
                            .font(.footnote)
                            .foregroundStyle(Lumen.muted)
                    }
                }

                Section {
                    Button("로그아웃", role: .destructive) {
                        Task {
                            await model.logout()
                            dismiss()
                        }
                    }
                }

                Section {
                    LabeledContent("버전", value: appVersion)
                }
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("완료") { dismiss() }
                }
            }
            .task { await notifications.refreshStatus() }
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "-"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "-"
        return "\(version) (\(build))"
    }
}
