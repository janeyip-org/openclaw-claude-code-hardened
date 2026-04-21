/**
 * Cross-session messaging (inbox) manager.
 *
 * Manages message delivery between sessions. Idle sessions receive messages
 * immediately; busy sessions queue for later delivery via deliverInbox().
 */
import { MAX_INBOX_SIZE } from './constants.js';
export class InboxManager {
    inboxes = new Map();
    static escapeXmlAttr(s) {
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    wrapCrossSessionMessage(msg) {
        const esc = InboxManager.escapeXmlAttr;
        const attrs = `from="${esc(msg.from)}"${msg.summary ? ` summary="${esc(msg.summary)}"` : ''}`;
        // SECURITY FIX: escape message body to prevent prompt injection.
        // Without this, a malicious session can craft a body containing
        // </cross-session-message> followed by arbitrary content, injecting
        // fake system messages into other sessions.
        const safeText = msg.text
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        return `<cross-session-message ${attrs}>\n${safeText}\n</cross-session-message>`;
    }
    /**
     * Send a message from one session to another (or broadcast with to='*').
     * Returns whether the message was delivered immediately or queued.
     */
    async sendTo(from, to, message, lookup, summary, onBroadcastError) {
        if (!lookup.exists(from))
            throw new Error(`Sender session '${from}' not found`);
        if (to !== '*' && !lookup.exists(to))
            throw new Error(`Target session '${to}' not found`);
        const inboxMsg = {
            from,
            text: message,
            timestamp: new Date().toISOString(),
            read: false,
            summary,
        };
        // Broadcast
        if (to === '*') {
            let delivered = 0;
            for (const name of lookup.allNames()) {
                if (name === from)
                    continue;
                try {
                    const ok = await this._deliverOrQueue(name, inboxMsg, lookup);
                    if (ok)
                        delivered++;
                }
                catch (err) {
                    onBroadcastError?.(name, err);
                }
            }
            return { delivered: delivered > 0, queued: delivered === 0 };
        }
        const delivered = await this._deliverOrQueue(to, inboxMsg, lookup);
        return { delivered, queued: !delivered };
    }
    /** Read inbox messages for a session. */
    inbox(name, unreadOnly = true) {
        const box = this.inboxes.get(name) || [];
        return unreadOnly ? box.filter((m) => !m.read) : box;
    }
    /** Deliver all queued unread messages to a session, mark as read. */
    async deliverInbox(name, lookup) {
        const managed = lookup.getSession(name);
        if (!managed)
            throw new Error(`Session '${name}' not found`);
        const box = this.inboxes.get(name);
        if (!box || box.length === 0)
            return 0;
        const unread = box.filter((m) => !m.read);
        if (unread.length === 0)
            return 0;
        const formatted = unread.map((m) => this.wrapCrossSessionMessage(m)).join('\n\n');
        await managed.session.send(formatted, { waitForComplete: false });
        for (const m of unread)
            m.read = true;
        return unread.length;
    }
    /** Clear inbox for a session. */
    clear(name) {
        this.inboxes.delete(name);
    }
    // ── Private ─────────────────────────────────────────────────────────────
    async _deliverOrQueue(sessionName, msg, lookup) {
        const managed = lookup.getSession(sessionName);
        if (!managed)
            return false;
        // If session is idle, deliver directly
        if (!managed.session.isBusy && managed.session.isReady) {
            try {
                await managed.session.send(this.wrapCrossSessionMessage(msg), { waitForComplete: false });
                msg.read = true;
                return true;
            }
            catch {
                // Fall through to queue
            }
        }
        // Queue in inbox (with size cap — drop oldest read messages first)
        if (!this.inboxes.has(sessionName))
            this.inboxes.set(sessionName, []);
        const box = this.inboxes.get(sessionName);
        if (box.length >= MAX_INBOX_SIZE) {
            const readIdx = box.findIndex((m) => m.read);
            if (readIdx >= 0)
                box.splice(readIdx, 1);
            else
                box.shift(); // drop oldest unread as last resort
        }
        box.push(msg);
        return false;
    }
}
//# sourceMappingURL=inbox-manager.js.map