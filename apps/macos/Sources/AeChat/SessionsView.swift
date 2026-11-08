import AeChatKit
import SwiftUI

struct SessionsView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            Divider()
            if state.isBinaryMissing {
                ContentUnavailableView(
                    "aechat not found",
                    systemImage: "terminal",
                    description: Text(
                        "Set AECHAT_BIN, put aechat on PATH, or choose the binary from the error banner."
                    )
                )
            } else if state.sessions.isEmpty && !state.isLoading {
                ContentUnavailableView(
                    "No sessions",
                    systemImage: "person.2.slash",
                    description: Text("No AeChat session is registered in this store.")
                )
            } else {
                sessionList
            }
        }
        .searchable(text: $state.searchText, placement: .sidebar, prompt: "Search sessions")
        .navigationTitle("Sessions")
    }

    private var filterBar: some View {
        HStack(spacing: 12) {
            Toggle("Left", isOn: $state.showLeft)
                .toggleStyle(.checkbox)
            Toggle("Pending", isOn: $state.onlyPending)
                .toggleStyle(.checkbox)
            Spacer()
            if state.isLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var sessionList: some View {
        List(
            selection: Binding(
                get: { state.selectedSessionId },
                set: { state.selectSession($0) }
            )
        ) {
            ForEach(groups) { group in
                Section(group.title) {
                    ForEach(group.sessions) { session in
                        SessionRow(
                            session: session,
                            pending: state.pendingSessionIds.contains(session.sessionId)
                        )
                        .tag(session.sessionId)
                    }
                }
            }
        }
        .listStyle(.sidebar)
    }

    private var groups: [SessionGroup] {
        let filtered = state.filteredSessions
        let byClient = Dictionary(grouping: filtered, by: \.client)
        var result: [SessionGroup] = []
        for client in byClient.keys.sorted() {
            let byProject = Dictionary(grouping: byClient[client] ?? [], by: \.project)
            for project in byProject.keys.sorted() {
                result.append(
                    SessionGroup(
                        id: "\(client)/\(project)",
                        title: "\(client) · \(project)",
                        sessions: (byProject[project] ?? []).sorted {
                            $0.displayName < $1.displayName
                        }
                    )
                )
            }
        }
        return result
    }
}

private struct SessionGroup: Identifiable {
    let id: String
    let title: String
    let sessions: [SessionView]
}

private struct SessionRow: View {
    let session: SessionView
    let pending: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Display.statusColor(session.status))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(session.displayName)
                        .lineLimit(1)
                    if pending {
                        Image(systemName: "tray.full.fill")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
                Text("\(session.client) · \(Display.shortSession(session.sessionId))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let address = session.address {
                    Text(address)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text("\(session.boundScope) · \(session.boundState)")
                    .font(.caption2)
                    .foregroundStyle(Display.bindingColor(session.boundState))
                    .lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Display.relative(session.hostSeenAt ?? session.lastSeenAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if session.hostSeenAt != nil {
                    Text("host")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
