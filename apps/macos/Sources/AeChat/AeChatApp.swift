import AppKit
import SwiftUI

@main
struct AeChatApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup("AeChat") {
            RootView()
                .environmentObject(state)
                .tint(Theme.Palette.accent)
                .frame(minWidth: 760, minHeight: 560)
        }
        .windowToolbarStyle(.unified)

        Settings {
            SettingsView()
                .environmentObject(state)
                .tint(Theme.Palette.accent)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        Group {
            if state.selectedSessionId == nil {
                NavigationSplitView {
                    sidebar
                } detail: {
                    content
                }
            } else {
                NavigationSplitView {
                    sidebar
                } content: {
                    content
                } detail: {
                    detail
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: Theme.Spacing.small) {
                    SettingsLink {
                        Label("Settings", systemImage: "gearshape")
                    }
                    .keyboardShortcut(",", modifiers: .command)
                    Button {
                        Task { await state.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .keyboardShortcut("r", modifiers: .command)
                    .disabled(state.isLoading || state.isBinaryMissing)
                }
            }
        }
        .task {
            await state.refresh()
        }
        .onReceive(
            NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)
        ) { _ in
            state.stopStream()
        }
        .overlay(alignment: .bottom) {
            if let error = state.errorMessage {
                ErrorBanner(message: error, recovery: AnyView(pathChooser))
            }
        }
    }

    private var sidebar: some View {
        SessionsView()
            .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
    }

    @ViewBuilder
    private var content: some View {
        if state.activeThread != nil {
            ChatView()
                .navigationSplitViewColumnWidth(min: 360, ideal: 520)
        } else if state.isBinaryMissing {
            missingBinary
                .navigationSplitViewColumnWidth(min: 320, ideal: 400)
        } else if isEmptyStore {
            emptyStore
                .navigationSplitViewColumnWidth(min: 320, ideal: 400)
        } else {
            OverviewView()
                .navigationSplitViewColumnWidth(min: 320, ideal: 400)
        }
    }

    private var isEmptyStore: Bool {
        state.snapshot != nil && state.sessions.isEmpty && !state.isLoading
    }

    private var missingBinary: some View {
        ContentUnavailableView(
            "aechat not found",
            systemImage: "terminal",
            description: Text(
                "Set AECHAT_BIN, put aechat on PATH, or choose the binary from the error banner."
            )
        )
    }

    private var emptyStore: some View {
        ContentUnavailableView {
            Label("No sessions yet", systemImage: "person.2.badge.plus")
        } description: {
            VStack(spacing: Theme.Spacing.small) {
                Text(
                    "Open each host conversation and ask its agent to use the aechat skill. The agents register themselves and find each other."
                )
                Text(
                    "No display names, addresses, or session ids need to be configured here."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        } actions: {
            Button("Refresh") {
                Task { await state.refresh() }
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        if state.selectedMessageId != nil {
            InspectorView()
        } else {
            SessionDetailView()
        }
    }

    private var pathChooser: some View {
        Button("Choose aechat…") {
            let panel = NSOpenPanel()
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            if panel.runModal() == .OK, let url = panel.url {
                state.chooseBinary(url)
            }
        }
    }
}

struct ErrorBanner: View {
    let message: String
    let recovery: AnyView

    init(message: String, recovery: AnyView) {
        self.message = message
        self.recovery = recovery
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.small) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.Palette.attention)
            Text(message)
                .font(.callout)
                .lineLimit(2)
            Spacer()
            recovery
        }
        .padding(Theme.Spacing.medium)
        .background(
            .regularMaterial,
            in: RoundedRectangle(cornerRadius: Theme.Radius.large)
        )
        .padding()
    }
}
