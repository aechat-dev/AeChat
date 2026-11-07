import AeChatKit
import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    @Published private(set) var snapshot: UiSnapshot?
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published var searchText = ""
    @Published var showLeft = false
    @Published var onlyPending = false
    @Published var selectedSessionId: String?
    @Published private(set) var binaryPath: String?

    private var client: AeChatClient?

    init() {
        configureBinary()
    }

    var isBinaryMissing: Bool { client == nil }

    var sessions: [SessionView] { snapshot?.sessions ?? [] }

    var selectedSession: SessionView? {
        guard let selectedSessionId else { return nil }
        return sessions.first { $0.sessionId == selectedSessionId }
    }

    var filteredSessions: [SessionView] {
        let pending = pendingSessionIds
        let needle = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return sessions.filter { session in
            if !showLeft && session.isLeft { return false }
            if onlyPending && !pending.contains(session.sessionId) { return false }
            guard !needle.isEmpty else { return true }
            return [session.displayName, session.project, session.client, session.sessionId]
                .contains { $0.lowercased().contains(needle) }
        }
    }

    var pendingSessionIds: Set<String> {
        var ids = Set<String>()
        for thread in snapshot?.threads ?? [] {
            guard thread.pendingRequests > 0 || thread.pendingDeliveries > 0 else { continue }
            for participant in thread.participants {
                ids.insert(participant.sessionId)
            }
        }
        return ids
    }

    func refresh() async {
        guard let client else {
            errorMessage = AeChatClientError.binaryNotFound.localizedDescription
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            snapshot = try await client.snapshot()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func chooseBinary(_ url: URL) {
        UserDefaults.standard.set(url.path, forKey: Self.binaryDefaultsKey)
        binaryPath = url.path
        client = AeChatClient(binary: url)
        Task { await refresh() }
    }

    var binaryHint: String {
        binaryPath ?? "Not found"
    }

    private func configureBinary() {
        let stored = UserDefaults.standard.string(forKey: Self.binaryDefaultsKey)
        if let stored, FileManager.default.isExecutableFile(atPath: stored) {
            binaryPath = stored
            client = AeChatClient(binary: URL(fileURLWithPath: stored))
            return
        }
        // AECHAT_BIN, bundled CLI, then PATH.
        if let located = AeChatClient.locateBinary() {
            binaryPath = located.path
            client = AeChatClient(binary: located)
        }
    }

    private static let binaryDefaultsKey = "AeChatBinaryPath"
}
