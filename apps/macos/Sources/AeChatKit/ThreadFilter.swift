import Foundation

/// Pure filtering for the Conversations list. A thread stays visible when at
/// least one participant passes the session filters; an "only pending" view
/// additionally requires pending work on the thread itself.
public enum ThreadFilter {
    public static func visible(
        _ threads: [ThreadSummary],
        visibleSessionIds: Set<String>,
        onlyPending: Bool
    ) -> [ThreadSummary] {
        threads
            .filter { thread in
                thread.participants.contains {
                    visibleSessionIds.contains($0.sessionId)
                }
                    && (!onlyPending
                        || thread.pendingRequests > 0
                        || thread.pendingDeliveries > 0)
            }
            .sorted { $0.lastMessageAt > $1.lastMessageAt }
    }
}
