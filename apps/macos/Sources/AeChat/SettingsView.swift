import AeChatKit
import AppKit
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var state: AppState
    @AppStorage("AeChatFontSize") private var fontSize = 13.0
    @AppStorage("AeChatRefreshInterval") private var refreshInterval = 10.0
    @AppStorage("AeChatUse24Hour") private var use24Hour = true

    var body: some View {
        Form {
            Section {
                Label {
                    Text(
                        "AeChat is a read-only monitor. It never sends, replies, acknowledges or claims deliveries."
                    )
                    .font(.callout)
                } icon: {
                    Image(systemName: "lock.shield")
                        .foregroundStyle(Theme.Palette.healthy)
                }
            }

            Section("Display") {
                Slider(value: $fontSize, in: 11...18, step: 1) {
                    Text("Message font size")
                } minimumValueLabel: {
                    Text("11").font(.caption2)
                } maximumValueLabel: {
                    Text("18").font(.caption2)
                }
                Toggle("Use 24-hour time", isOn: $use24Hour)
                Slider(value: $refreshInterval, in: 2...60, step: 1) {
                    Text("Snapshot fallback interval: \(Int(refreshInterval))s")
                }
            }

            Section("Doctor") {
                if let doctor = state.doctor {
                    doctorFacts(doctor)
                } else if let error = state.doctorError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Theme.Palette.failure)
                } else if state.isLoadingDoctor {
                    ProgressView("Reading read-only facts…")
                        .controlSize(.small)
                } else {
                    Button("Load doctor facts") {
                        Task { await state.loadDoctor() }
                    }
                }
            }

            Section("CLI") {
                fact("Binary", state.binaryHint)
                Button("Choose aechat…") {
                    chooseBinary()
                }
                copyRow("Copy repair command", "aechat doctor")
                copyRow("Copy build command", "pnpm build")
                copyRow(
                    "Copy explicit binary",
                    "AECHAT_BIN=\"\(state.binaryHint)\""
                )
            }

            Section("Notes") {
                Text(
                    "Snapshot polling while the live stream is down uses the fallback interval above. Message bodies are agent text and are never executed or auto-linked."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 520, height: 560)
        .task {
            if state.doctor == nil {
                await state.loadDoctor()
            }
        }
    }

    private func doctorFacts(_ doctor: UiDoctor) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
            fact("Node", "\(doctor.node.version) \(doctor.node.platform)/\(doctor.node.arch)")
            fact("agmsg", doctor.agmsg.version ?? "unknown")
            if let error = doctor.agmsg.error {
                fact("agmsg error", error)
            }
            fact("Supported", doctor.agmsg.supported.map(String.init) ?? "—")
            fact("Database", "\(doctor.database.path) · \(doctor.database.mode ?? "—")")
            fact("Schema", doctor.database.schemaVersion.map(String.init) ?? "—")
            fact("Quick check", doctor.database.quickCheck ?? "—")
            fact("Store", doctor.database.readOnly ? "read-only" : "writable")
            fact(
                "Logs",
                "\(doctor.logs.path) · exists=\(doctor.logs.exists) writable=\(doctor.logs.writable) mode=\(doctor.logs.mode ?? "—")"
            )
            fact("Home", doctor.config.home)
            fact("Team", doctor.config.team)
            fact("Transport", "\(doctor.transport.name) · \(doctor.transport.bindings) binding(s)")
            fact("Hook paths", doctor.hostHook.paths.joined(separator: ", "))
            fact(
                "Hooks",
                doctor.hostHook.configured.isEmpty
                    ? "none configured" : doctor.hostHook.configured.joined(separator: ", "))
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.small) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func copyRow(_ title: String, _ value: String) -> some View {
        HStack(spacing: Theme.Spacing.small) {
            Text(value)
                .font(.caption.monospaced())
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Button(title) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(value, forType: .string)
            }
            .controlSize(.small)
        }
    }

    private func chooseBinary() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            state.chooseBinary(url)
        }
    }
}
