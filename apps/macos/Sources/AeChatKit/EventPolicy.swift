import Foundation

/// What the app should reload after one stream line. The stream is a change
/// signal, not a full state transfer: snapshot-derived fields still come from
/// `ui-snapshot`, but they are now refreshed on events and a slow reconcile
/// timer instead of every two-second tick.
public struct EventDecision: Equatable {
    public let gap: Bool
    public let refreshSnapshot: Bool
    public let reloadMessages: Bool
    public let reloadLog: Bool
    public let newActivity: Bool

    public init(
        gap: Bool = false,
        refreshSnapshot: Bool = false,
        reloadMessages: Bool = false,
        reloadLog: Bool = false,
        newActivity: Bool = false
    ) {
        self.gap = gap
        self.refreshSnapshot = refreshSnapshot
        self.reloadMessages = reloadMessages
        self.reloadLog = reloadLog
        self.newActivity = newActivity
    }
}

/// Tracks the observed event cursor and maps one line to the minimal reload.
public struct EventPolicy {
    public private(set) var observedSeq: Int

    public init(observedSeq: Int = 0) {
        self.observedSeq = observedSeq
    }

    /// A fresh snapshot is authoritative; move the cursor to its event seq.
    public mutating func reset(to seq: Int) {
        observedSeq = seq
    }

    public mutating func decide(
        event: UiEventLine,
        snapshotSeq: Int,
        threadSessionIds: Set<String>,
        selectedMessageId: String?
    ) -> EventDecision {
        // Ticks carry no seq; the app reconciles them on a slow timer.
        guard let seq = event.seq else {
            return EventDecision()
        }
        // The snapshot already includes this event (replay on connect).
        if seq <= snapshotSeq {
            return EventDecision()
        }

        // A first event after an empty snapshot (seq 0) is still a gap when
        // its sequence skips a number.
        let gap = seq > observedSeq + 1
        observedSeq = max(observedSeq, seq)

        let name = event.event ?? ""
        let messageEvent = name == "send" || name == "reply"
        // Both sides must be in the open thread; otherwise a participant
        // writing to another session would look like active-thread activity.
        let inThread =
            event.sessionId.map(threadSessionIds.contains) == true
            && event.data?.toSession.map(threadSessionIds.contains) == true
        let reloadMessages = messageEvent && inThread
        let reloadLog =
            selectedMessageId != nil
            && (event.messageId == selectedMessageId
                || event.requestId == selectedMessageId)

        return EventDecision(
            gap: gap,
            // Heartbeats only move last-seen timestamps; do not pay for a
            // full transport inspection on every one.
            refreshSnapshot: gap || name != "heartbeat",
            reloadMessages: reloadMessages,
            reloadLog: reloadLog,
            newActivity: reloadMessages
        )
    }
}
