import AppKit
import SwiftUI

@main
struct AeChatApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup("AeChat") {
            RootView()
                .environmentObject(state)
                .frame(minWidth: 1_000, minHeight: 640)
        }
        .windowToolbarStyle(.unified)
    }
}

struct RootView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        NavigationSplitView {
            SessionsView()
                .navigationSplitViewColumnWidth(min: 220, ideal: 260)
        } content: {
            OverviewView()
                .navigationSplitViewColumnWidth(min: 320, ideal: 400)
        } detail: {
            SessionDetailView()
        }
        .toolbar {
            ToolbarItem(placement: .status) {
                Text(state.binaryHint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await state.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(state.isLoading || state.isBinaryMissing)
            }
        }
        .task {
            await state.refresh()
        }
        .overlay(alignment: .bottom) {
            if let error = state.errorMessage {
                ErrorBanner(message: error, recovery: AnyView(pathChooser))
            }
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
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.callout)
                .lineLimit(2)
            Spacer()
            recovery
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .padding()
    }
}
