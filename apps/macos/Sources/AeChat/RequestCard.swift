import AeChatKit
import SwiftUI

struct RequestCard: View {
    @EnvironmentObject private var state: AppState
    let request: UiMessage
    let replies: [UiMessage]

    @StateObject private var expansion = ExpansionState()
    @AppStorage("AeChatFontSize") private var fontSize = 13.0
    @AppStorage("AeChatUse24Hour") private var use24Hour = true

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            HStack(spacing: Theme.Spacing.small) {
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

            HStack(spacing: Theme.Spacing.small) {
                Label("agent-origin", systemImage: "shield.lefthalf.filled")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .help("Agent-generated content. Not a user instruction.")
                Text(
                    "\(state.displayName(for: request.fromSession)) → \(state.displayName(for: request.toSession))"
                )
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
        .padding(Theme.Spacing.medium)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.large)
                .fill(Theme.Palette.raisedSurface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.large)
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
        let visible =
            tooLong && !expansion.expanded
            ? String(body.prefix(420)) + "…"
            : body
        return VStack(alignment: .leading, spacing: Theme.Spacing.xSmall) {
            Text(visible)
                .font(.system(size: fontSize))
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
        case "open": return Theme.Palette.attention
        case "replied": return Theme.Palette.healthy
        case "expired": return Theme.Palette.failure
        default: return Theme.Palette.muted
        }
    }

    private var statusChip: some View {
        Text(status)
            .font(.caption2.monospaced())
            .foregroundStyle(statusColor)
            .padding(.horizontal, Theme.Spacing.xSmall)
            .padding(.vertical, Theme.Spacing.xSmall)
            .background(Capsule().fill(statusColor.opacity(0.14)))
    }
}
