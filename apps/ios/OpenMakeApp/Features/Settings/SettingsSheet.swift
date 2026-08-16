// 설정 시트 — 계정·응답 스타일·서버 정보·로그아웃
import SwiftUI
import OpenMakeKit

struct SettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

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
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "-"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "-"
        return "\(version) (\(build))"
    }
}
