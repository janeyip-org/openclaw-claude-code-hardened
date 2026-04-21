/**
 * Cross-session messaging (inbox) manager.
 *
 * Manages message delivery between sessions. Idle sessions receive messages
 * immediately; busy sessions queue for later delivery via deliverInbox().
 */
import type { InboxMessage, ISession } from './types.js';
/**
 * Callback interface — allows InboxManager to look up sessions
 * without depending on SessionManager directly.
 */
export interface SessionLookup {
    getSession(name: string): {
        session: ISession;
    } | undefined;
    exists(name: string): boolean;
    allNames(): Iterable<string>;
}
export declare class InboxManager {
    private inboxes;
    static escapeXmlAttr(s: string): string;
    wrapCrossSessionMessage(msg: InboxMessage): string;
    /**
     * Send a message from one session to another (or broadcast with to='*').
     * Returns whether the message was delivered immediately or queued.
     */
    sendTo(from: string, to: string, message: string, lookup: SessionLookup, summary?: string, onBroadcastError?: (name: string, err: Error) => void): Promise<{
        delivered: boolean;
        queued: boolean;
    }>;
    /** Read inbox messages for a session. */
    inbox(name: string, unreadOnly?: boolean): InboxMessage[];
    /** Deliver all queued unread messages to a session, mark as read. */
    deliverInbox(name: string, lookup: SessionLookup): Promise<number>;
    /** Clear inbox for a session. */
    clear(name: string): void;
    private _deliverOrQueue;
}
