// 로그인 화면 (MVP — 이메일/비밀번호 + Google OAuth)
import SwiftUI
import AuthenticationServices
import OpenMakeKit

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var providers: [String] = []

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("OpenMake")
                .font(.largeTitle.bold())

            VStack(spacing: 12) {
                TextField("이메일", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                SecureField("비밀번호", text: $password)
                    .textContentType(.password)
                    .textFieldStyle(.roundedBorder)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Button {
                Task { await submit() }
            } label: {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("로그인")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoading || email.isEmpty || password.isEmpty)

            if providers.contains("google") {
                Button {
                    Task { await googleLogin() }
                } label: {
                    Label("Google로 로그인", systemImage: "globe")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isLoading)
            }

            Spacer()
        }
        .padding(24)
        .task {
            providers = (try? await model.client.oauthProviders()) ?? []
        }
    }

    /// Google OAuth (축 2 exchange code 흐름) —
    /// ASWebAuthenticationSession → `openmake://auth/callback?code=` → 토큰 교환
    private func googleLogin() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            var components = URLComponents(
                url: AppConfig.serverURL.appending(path: "/api/auth/login/google"),
                resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "client", value: "ios")]
            let callback = try await webAuth.authenticate(
                using: components.url!,
                callbackURLScheme: AppConfig.appScheme)
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
                errorMessage = "콜백에서 코드를 찾지 못했습니다"
                return
            }
            try await model.exchangeLogin(code: code)
        } catch is ASWebAuthenticationSessionError {
            // 사용자 취소 — 조용히 무시
        } catch let error as OpenMakeAPIError {
            if case .server(_, _, let message) = error {
                errorMessage = message ?? "토큰 교환에 실패했습니다"
            } else {
                errorMessage = "토큰 교환에 실패했습니다"
            }
        } catch {
            errorMessage = "로그인에 실패했습니다: \(error.localizedDescription)"
        }
    }

    private func submit() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            try await model.login(email: email, password: password)
        } catch let error as OpenMakeAPIError {
            switch error {
            case .server(_, _, let message):
                errorMessage = message ?? "로그인에 실패했습니다"
            case .notAuthenticated:
                errorMessage = "로그인에 실패했습니다"
            case .invalidResponse:
                errorMessage = "서버 응답을 처리할 수 없습니다"
            }
        } catch {
            errorMessage = "네트워크 오류: \(error.localizedDescription)"
        }
    }
}
