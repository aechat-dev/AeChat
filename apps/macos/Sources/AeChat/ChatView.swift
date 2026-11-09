import AeChatKit
import SwiftUI

@MainActor
final class ChatScrollState: ObservableObject {
    @Published var loadingOlder = false
    @Published var pendingAnchor: String?
}

struct ChatView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var scrollState = ChatScrollState()

    var body: some View {
        Group {
            if let thread = state.activeThread {
                chat(thread)
            } else if state.selectedSession != nil {
                ContentUnavailableView(
                    "No AeChat messages",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("This session has no messages yet.")
                )
            } else {
                ContentUnavailableView(
                    "Select a conversation",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Choose a session to open its AeChat timeline.")
                )
            }
        }
        .navigationTitle(state.activeThread.map(participants) ?? "Chat")
    }

    private func chat(_ thread: ThreadSummary) -> some View {
        VStack(spacing: 0) {
            header(thread)
            Divider()
            timeline
        }
    }

    private func header(_ thread: ThreadSummary) -> some View {
        HStack(spacing: Theme.Spacing.small) {
            Text(participants(thread))
                .font(Theme.Typography.sectionTitle)
                .lineLimit(1)
                .truncationMode(.middle)
                .layoutPriority(1)
            Text("\(thread.pendingRequests) req · \(thread.pendingDeliveries) delivery")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: Theme.Spacing.small)
            HStack(spacing: Theme.Spacing.xSmall) {
                Circle()
                    .fill(
                        state.streamConnected
                            ? Theme.Palette.healthy : Theme.Palette.attention
                    )
                    .frame(width: 6, height: 6)
                Text(state.streamConnected ? "live" : "reconnecting")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .fixedSize()
            if state.hasNewActivity {
                Button {
                    state.markActivitySeen()
                } label: {
                    Label("New activity", systemImage: "arrow.down.circle.fill")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
            if state.isLoadingMessages {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, Theme.Spacing.medium)
        .padding(.vertical, Theme.Spacing.small)
    }

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    if state.nextBefore != nil {
                        Button("Load older") {
                            loadOlder()
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                        .frame(maxWidth: .infinity)
                    }
                    ForEach(items) { item in
                        Group {
                            switch item {
                            case .request(let request, let replies):
                                RequestCard(request: request, replies: replies)
                            case .message(let message):
                                MessageRow(message: message)
                            }
                        }
                        .id(item.messageId)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(Theme.Spacing.medium)
            }
            .onAppear {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .onChange(of: state.messages.count) { _, _ in
                if scrollState.loadingOlder {
                    // Restore the reading position after older messages land.
                    if let anchor = scrollState.pendingAnchor {
                        proxy.scrollTo(anchor, anchor: .top)
                    }
                    scrollState.pendingAnchor = nil
                    scrollState.loadingOlder = false
                    return
                }
                if !state.hasNewActivity {
                    withAnimation {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
            .onChange(of: state.hasNewActivity) { _, newValue in
                if !newValue {
                    withAnimation {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
        }
    }

    private func loadOlder() {
        guard !scrollState.loadingOlder else { return }
        let before = state.messages.count
        // Keep the current top message in place; the user is reading upward.
        scrollState.pendingAnchor = state.orderedMessages.first?.messageId
        scrollState.loadingOlder = true
        Task {
            await state.loadOlder()
            // onChange clears the flag when the count changes. If nothing new
            // arrived, clear it here after the body had a chance to update.
            try? await Task.sleep(nanoseconds: 150_000_000)
            if state.messages.count == before {
                scrollState.pendingAnchor = nil
                scrollState.loadingOlder = false
            }
        }
    }

    private var items: [TimelineItem] {
        let ordered = state.orderedMessages
        var repliesByRequest: [String: [UiMessage]] = [:]
        for message in ordered where message.kind == "reply" {
            if let parent = message.replyTo {
                repliesByRequest[parent, default: []].append(message)
            }
        }
        var items: [TimelineItem] = []
        var consumed = Set<String>()
        for message in ordered {
            if consumed.contains(message.messageId) { continue }
            if message.kind == "request" {
                let replies = repliesByRequest[message.messageId] ?? []
                for reply in replies {
                    consumed.insert(reply.messageId)
                }
                items.append(.request(message, replies))
            } else {
                items.append(.message(message))
            }
        }
        return items
    }

    private func participants(_ thread: ThreadSummary) -> String {
        thread.participants.map(\.displayName).joined(separator: " ↔ ")
    }
}

private enum TimelineItem: Identifiable {
    case request(UiMessage, [UiMessage])
    case message(UiMessage)

    var id: String {
        switch self {
        case .request(let message, _): return "request-\(message.messageId)"
        case .message(let message): return "message-\(message.messageId)"
        }
    }

    var messageId: String {
        switch self {
        case .request(let message, _): return message.messageId
        case .message(let message): return message.messageId
        }
    }
}
