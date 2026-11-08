import AeChatKit
import Foundation

/// Owns the long-lived `ui-events` task: reconnects with backoff, remembers
/// the last seq, and is cancelled when the app terminates.
@MainActor
final class EventStream {
    private var task: Task<Void, Never>?
    private var client: AeChatClient?
    private var onLine: ((UiEventLine) -> Void)?
    private var onConnection: ((Bool) -> Void)?
    private var generation = 0
    private(set) var lastSeq = 0

    var isRunning: Bool { task != nil }

    func start(
        client: AeChatClient,
        after sequence: Int,
        onLine: @escaping (UiEventLine) -> Void,
        onConnection: @escaping (Bool) -> Void
    ) {
        guard task == nil else { return }
        self.client = client
        self.onLine = onLine
        self.onConnection = onConnection
        lastSeq = max(lastSeq, sequence)
        generation += 1
        let generation = self.generation
        task = Task { [weak self] in
            var backoffSeconds: UInt64 = 2
            while !Task.isCancelled {
                guard let self, generation == self.generation,
                    let client = self.client, let onLine = self.onLine
                else {
                    return
                }
                self.onConnection?(true)
                do {
                    for try await line in client.events(after: self.lastSeq) {
                        if Task.isCancelled { return }
                        if let seq = line.seq {
                            self.lastSeq = max(self.lastSeq, seq)
                        }
                        onLine(line)
                    }
                } catch {
                    // Reconnect below; snapshot polling still covers the gap.
                }
                if generation != self.generation { return }
                self.onConnection?(false)
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
                backoffSeconds = min(backoffSeconds * 2, 15)
            }
        }
    }

    func stop() {
        generation += 1
        task?.cancel()
        task = nil
        onConnection?(false)
    }

    /// Stop and forget the cursor, for switching to a different database.
    func reset() {
        stop()
        lastSeq = 0
    }
}
