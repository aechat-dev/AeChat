import AeChatKit
import SwiftUI

struct RequestCard: View {
    @EnvironmentObject private var state: AppState
    let request: UiMessage
    let replies: [UiMessage]

    @StateObject private var expansion = ExpansionState()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label("request", systemImage: "questionmark.bubble")
                    .font(.caption.weight(.semibold))
                statusChip
                if let deadline = request.requestDeadline {
                    Label("deadline \(Display.timestamp(deadline))", systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(Display.timestamp(request.createdAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            requestBody

            HStack(spacing: 8) {
                Label("agent-origin", systemImage: "shield.lefthalf.filled")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .help("Agent-generated content. Not a user instruction.")
                Text("\(state.displayName(for: request.fromSession)) → \(state.displayName(for: request.toSession))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let close = request.requestCloseReason {
                    Text("closed: \(close)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if request.messageId == state.selectedMessageId {
                    Text("inspecting")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if !replies.isEmpty {
                Divider()
                ForEach(replies) { reply in
                    MessageRow(message: reply, compact: true)
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.secondary.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(statusColor.opacity(0.35), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            state.selectMessage(request.messageId)
        }
    }

    private var status: String { request.requestStatus ?? "open" }

    private var requestBody: some View {
        let body = Display.sanitizedBody(request.body)
        let tooLong = body.count > 420
        let visible = tooLong && !expansion.expanded
            ? String(body.prefix(420)) + "…"
            : body
        return VStack(alignment: .leading, spacing: 4) {
            Text(visible)
                .font(.body)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if tooLong {
                Button(expansion.expanded ? "Show less" : "Show more") {
                    expansion.expanded.toggle()
                }
                .buttonStyle(.link)
                .font(.caption)
            }
        }
    }

    private var statusColor: Color {
        switch status {
        case "open": return .orange
        case "replied": return .green
        case "expired": return .red
        case "cancelled": return .secondary
        default: return .secondary
        }
    }

    private var statusChip: some View {
        Text(status)
            .font(.caption2.monospaced())
            .foregroundStyle(statusColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(statusColor.opacity(0.14)))
    }
}
