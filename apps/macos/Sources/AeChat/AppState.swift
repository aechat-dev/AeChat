import AeChatKit
import Darwin
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

    @Published private(set) var messages: [UiMessage] = []  // newest first
    @Published private(set) var nextBefore: String?
    @Published private(set) var isLoadingMessages = false
    @Published private(set) var hasLoadedAllOlder = false
    @Published private(set) var selectedThreadKey: String?
    @Published private(set) var selectedMessageId: String?
    @Published private(set) var selectedLog: UiLog?
    @Published private(set) var logError: String?
    @Published private(set) var hasNewActivity = false
    @Published private(set) var streamConnected = false
    @Published private(set) var doctor: UiDoctor?
    @Published private(set) var doctorError: String?
    @Published private(set) var isLoadingDoctor = false

    private var client: AeChatClient?
    private let stream = EventStream()
    private var snapshotTask: Task<Void, Never>?
    private var messageTask: Task<Void, Never>?
    private var reloadTask: Task<Void, Never>?
    private var fallbackTask: Task<Void, Never>?
    private var lastSnapshotRefresh = Date.distantPast
    private var loadGeneration = 0
    private var logGeneration = 0
    private var signalSources: [DispatchSourceSignal] = []

    init() {
        configureBinary()
        installSignalHandlers()
    }

    var isBinaryMissing: Bool { client == nil }

    var sessions: [SessionView] { snapshot?.sessions ?? [] }

    var selectedSession: SessionView? {
        guard let selectedSessionId else { return nil }
        return sessions.first { $0.sessionId == selectedSessionId }
    }

    var activeThread: ThreadSummary? {
        guard let selectedThreadKey else { return nil }
        return snapshot?.threads.first { $0.key == selectedThreadKey }
    }

    var orderedMessages: [UiMessage] { messages.reversed() }

    var selectedMessage: UiMessage? {
        guard let selectedMessageId else { return nil }
        return messages.first { $0.messageId == selectedMessageId }
    }

    func displayName(for sessionId: String) -> String {
        sessions.first { $0.sessionId == sessionId }?.displayName
            ?? String(sessionId.prefix(8))
    }

    /// The session whose perspective the chat is rendered from.
    var perspectiveSessionId: String? {
        guard let thread = activeThread else { return nil }
        if let selectedSessionId,
            thread.participants.contains(where: { $0.sessionId == selectedSessionId })
        {
            return selectedSessionId
        }
        return thread.participants.first?.sessionId
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

    // MARK: - Loading

    func refresh() async {
        guard let client else {
            errorMessage = AeChatClientError.binaryNotFound.localizedDescription
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let fresh = try await client.snapshot()
            apply(snapshot: fresh)
            errorMessage = nil
            startStreamIfNeeded()
        } catch {
            errorMessage = error.localizedDescription
        }
        await refreshActiveContext(markSeen: true)
    }

    private func refreshSnapshotFromStream() async {
        // Snapshot calls inspect every transport binding; keep the rate at or
        // below one per ~2s even when events are bursty.
        guard Date().timeIntervalSince(lastSnapshotRefresh) >= 1.8 else { return }
        lastSnapshotRefresh = Date()
        guard let client else { return }
        do {
            let fresh = try await client.snapshot()
            apply(snapshot: fresh)
            errorMessage = nil
        } catch {
            // Keep the last good snapshot; the banner already reports outages.
            return
        }
        await refreshActiveContext(markSeen: false)
    }

    private func apply(snapshot fresh: UiSnapshot) {
        snapshot = fresh
        if let key = selectedThreadKey,
            !fresh.threads.contains(where: { $0.key == key })
        {
            clearThreadSelection()
        }
    }

    /// Reload the open thread page and inspector after a tick or refresh.
    private func refreshActiveContext(markSeen: Bool) async {
        if activeThread != nil {
            await loadMessages(reset: true, markSeen: markSeen)
        }
        if let id = selectedMessageId {
            await loadLog(id, generation: logGeneration)
        }
    }

    // MARK: - Selection

    func selectSession(_ id: String?) {
        selectedSessionId = id
        guard let id,
            let thread = snapshot?.threads.first(where: {
                $0.participants.contains { $0.sessionId == id }
            })
        else {
            clearThreadSelection()
            return
        }
        selectThread(thread)
    }

    func selectThread(_ thread: ThreadSummary) {
        guard thread.key != selectedThreadKey else { return }
        loadGeneration += 1
        messageTask?.cancel()
        reloadTask?.cancel()
        selectedThreadKey = thread.key
        messages = []
        nextBefore = nil
        hasLoadedAllOlder = false
        clearInspector()
        hasNewActivity = false
        let generation = loadGeneration
        messageTask = Task { [weak self] in
            guard let self else { return }
            if generation == self.loadGeneration {
                await self.loadMessages(reset: true)
            }
        }
    }

    private func clearThreadSelection() {
        loadGeneration += 1
        messageTask?.cancel()
        reloadTask?.cancel()
        selectedThreadKey = nil
        messages = []
        nextBefore = nil
        hasLoadedAllOlder = false
        hasNewActivity = false
        clearInspector()
    }

    private func clearInspector() {
        logGeneration += 1
        selectedMessageId = nil
        selectedLog = nil
        logError = nil
    }

    // MARK: - Messages

    func loadMessages(reset: Bool, markSeen: Bool = true) async {
        let generation = loadGeneration
        guard let client, let thread = activeThread,
            let perspective = perspectiveSessionId,
            let counterpart = thread.participants.first(where: { $0.sessionId != perspective })
        else {
            return
        }
        if !reset && isLoadingMessages {
            return
        }
        let threadKey = thread.key
        let before = reset ? nil : nextBefore
        isLoadingMessages = true
        defer {
            if generation == loadGeneration {
                isLoadingMessages = false
            }
        }
        do {
            let page = try await client.messages(
                sessionId: perspective,
                counterpartId: counterpart.sessionId,
                before: before,
                limit: 50
            )
            guard generation == loadGeneration, activeThread?.key == threadKey else {
                return
            }
            let previousIds = Set(messages.map(\.messageId))
            merge(page.messages)
            let added = messages.contains { !previousIds.contains($0.messageId) }
            if reset {
                if !hasLoadedAllOlder && nextBefore == nil {
                    nextBefore = page.nextBefore
                }
                if markSeen {
                    hasNewActivity = false
                } else if added {
                    hasNewActivity = true
                }
            } else {
                nextBefore = page.nextBefore
                if page.nextBefore == nil {
                    hasLoadedAllOlder = true
                }
            }
        } catch {
            guard generation == loadGeneration else { return }
            errorMessage = error.localizedDescription
        }
    }

    func loadOlder() async {
        guard nextBefore != nil, !isLoadingMessages else { return }
        await loadMessages(reset: false)
    }

    /// Upsert by message id so a refresh never discards older pages.
    private func merge(_ page: [UiMessage]) {
        var byId = Dictionary(uniqueKeysWithValues: messages.map { ($0.messageId, $0) })
        for message in page {
            byId[message.messageId] = message
        }
        messages = byId.values.sorted { left, right in
            if left.createdAt != right.createdAt {
                return left.createdAt > right.createdAt
            }
            return left.messageId > right.messageId
        }
    }

    // MARK: - Inspector

    func selectMessage(_ id: String?) {
        logGeneration += 1
        let generation = logGeneration
        selectedMessageId = id
        selectedLog = nil
        logError = nil
        guard let id, client != nil else { return }
        Task { [weak self] in
            await self?.loadLog(id, generation: generation)
        }
    }

    private func loadLog(_ id: String, generation: Int) async {
        guard let client else { return }
        do {
            let log = try await client.log(messageId: id)
            guard generation == logGeneration, selectedMessageId == id else { return }
            selectedLog = log
            logError = nil
        } catch {
            guard generation == logGeneration, selectedMessageId == id else { return }
            logError = error.localizedDescription
        }
    }

    func markActivitySeen() {
        hasNewActivity = false
    }

    // MARK: - Doctor

    func loadDoctor() async {
        guard let client else {
            doctorError = AeChatClientError.binaryNotFound.localizedDescription
            return
        }
        isLoadingDoctor = true
        defer { isLoadingDoctor = false }
        do {
            doctor = try await client.doctor()
            doctorError = nil
        } catch {
            doctorError = error.localizedDescription
        }
    }

    // MARK: - Event stream

    private func startStreamIfNeeded() {
        guard !stream.isRunning, let client else { return }
        stream.start(
            client: client,
            after: snapshot?.eventSeq ?? 0,
            onLine: { [weak self] line in
                self?.handle(line)
            },
            onConnection: { [weak self] connected in
                self?.streamConnected = connected
            }
        )
        startFallbackPolling()
    }

    /// When the stream is down, keep the view roughly current with polling.
    private func startFallbackPolling() {
        guard fallbackTask == nil else { return }
        fallbackTask = Task { [weak self] in
            while !Task.isCancelled {
                let configured =
                    UserDefaults.standard.object(
                        forKey: "AeChatRefreshInterval"
                    ) as? Double
                let seconds = max(2, configured ?? 10)
                try? await Task.sleep(
                    nanoseconds: UInt64(seconds * 1_000_000_000)
                )
                guard let self else { return }
                if !Task.isCancelled && !self.streamConnected {
                    await self.refreshSnapshotFromStream()
                }
            }
        }
    }

    func stopStream() {
        stream.stop()
        streamConnected = false
        snapshotTask?.cancel()
        snapshotTask = nil
        reloadTask?.cancel()
        reloadTask = nil
        fallbackTask?.cancel()
        fallbackTask = nil
        AeChatClient.terminateActiveProcesses()
    }

    private func handle(_ line: UiEventLine) {
        // The snapshot already reflects these events; ignore replay on connect.
        if let seq = line.seq, seq <= (snapshot?.eventSeq ?? 0) {
            return
        }
        if line.kind == "snapshot" {
            scheduleSnapshotRefresh()
            return
        }
        if let thread = activeThread,
            let sessionId = line.sessionId,
            line.messageId != nil,
            line.event == "send" || line.event == "reply",
            thread.participants.contains(where: { $0.sessionId == sessionId })
        {
            hasNewActivity = true
            scheduleActiveReload()
        }
        scheduleSnapshotRefresh()
    }

    private func scheduleActiveReload() {
        reloadTask?.cancel()
        reloadTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self?.loadMessages(reset: true, markSeen: false)
        }
    }

    private func scheduleSnapshotRefresh() {
        snapshotTask?.cancel()
        snapshotTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            await self?.refreshSnapshotFromStream()
        }
    }

    // MARK: - Binary

    func chooseBinary(_ url: URL) {
        UserDefaults.standard.set(url.path, forKey: Self.binaryDefaultsKey)
        binaryPath = url.path
        client = AeChatClient(binary: url)
        doctor = nil
        doctorError = nil
        stream.reset()
        streamConnected = false
        Task {
            await refresh()
            await loadDoctor()
        }
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

    /// SIGTERM/SIGINT should stop the ui-events child before exiting; the
    /// normal quit path uses willTerminate, but a killed app must not leave a
    /// stream process behind.
    private func installSignalHandlers() {
        for signalNumber in [SIGTERM, SIGINT] {
            signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in
                self?.stopStream()
                exit(0)
            }
            source.resume()
            signalSources.append(source)
        }
    }
}
