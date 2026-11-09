import AeChatKit
import SwiftUI

struct SessionsView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            Divider()
            sessionList
        }
        .searchable(text: $state.searchText, placement: .sidebar, prompt: "Search sessions")
        .navigationTitle("Sessions")
    }

    private var filterBar: some View {
        HStack(spacing: Theme.Spacing.small) {
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
        .padding(.horizontal, Theme.Spacing.small)
        .padding(.vertical, Theme.Spacing.small)
    }

    private var sessionList: some View {
        List(
            selection: Binding(
                get: { state.selectedSessionId },
                set: { state.selectSession($0) }
            )
        ) {
            if !threads.isEmpty {
                Section("Conversations") {
                    ForEach(threads) { thread in
                        Button {
                            state.selectedSessionId =
                                thread.participants.first?.sessionId
                            state.selectThread(thread)
                        } label: {
                            ThreadRow(thread: thread)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
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

    private var threads: [ThreadSummary] {
        (state.snapshot?.threads ?? []).sorted {
            $0.lastMessageAt > $1.lastMessageAt
        }
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

private struct ThreadRow: View {
    let thread: ThreadSummary

    private var pending: Bool {
        thread.pendingRequests > 0 || thread.pendingDeliveries > 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            HStack(spacing: Theme.Spacing.small) {
                Text(
                    thread.participants
                        .map(\.displayName)
                        .joined(separator: " ↔ ")
                )
                .lineLimit(1)
                if pending {
                    Image(systemName: "tray.full.fill")
                        .font(.caption2)
                        .foregroundStyle(Theme.Palette.attention)
                }
            }
            Text(thread.lastMessage.preview)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: Theme.Spacing.small) {
                Text(
                    thread.participants
                        .map(\.client)
                        .joined(separator: " + ")
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                Spacer()
                Text(Display.relative(thread.lastMessageAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, Theme.Spacing.xSmall)
        .contentShape(Rectangle())
    }
}

private struct SessionRow: View {
    let session: SessionView
    let pending: Bool

    var body: some View {
        HStack(spacing: Theme.Spacing.small) {
            Circle()
                .fill(Display.statusColor(session.status))
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
                HStack(spacing: Theme.Spacing.small) {
                    Text(session.displayName)
                        .lineLimit(1)
                    if pending {
                        Image(systemName: "tray.full.fill")
                            .font(.caption2)
                            .foregroundStyle(Theme.Palette.attention)
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
            VStack(alignment: .trailing, spacing: Theme.Spacing.xSmall) {
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
        .padding(.vertical, Theme.Spacing.xSmall)
    }
}
