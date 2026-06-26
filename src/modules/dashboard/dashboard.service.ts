import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { Message, MessageDirection, MessageStatus } from '../message/entities/message.entity';
import { MessageBatch } from '../message/entities/message-batch.entity';
import { SavedContact } from '../contact/entities/saved-contact.entity';

/** Message types that count as "media" for the media-messages metric. */
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'ptt', 'document', 'sticker']);

/**
 * A metric value that may be unavailable given the current DB schema.
 * `value` is null when unavailable; `note` then explains the missing field.
 */
export interface MetricAvailability<T> {
  value: T | null;
  available: boolean;
  note?: string;
}

export interface DashboardAnalytics {
  date: string; // YYYY-MM-DD (server timezone)
  generatedAt: string;
  cards: {
    activeSessions: number;
    incomingToday: number;
    repliedToday: number;
    outgoingToday: number;
    broadcastToday: number;
    totalChatsToday: number;
    unreadChats: MetricAvailability<number>;
    failedToday: number;
    avgResponseTimeSec: MetricAvailability<number>;
    replyRate: MetricAvailability<number>; // 0..1
    mediaToday: number;
    topSession: { sessionId: string; name: string; messageCount: number } | null;
  };
  hourly: Array<{ hour: number; incoming: number; outgoing: number }>;
  incomingVsOutgoing: { incoming: number; outgoing: number };
  broadcast: {
    batches: number;
    total: number;
    sent: number;
    failed: number;
    pending: number;
    cancelled: number;
  };
  sessionPerformance: Array<{
    sessionId: string;
    name: string;
    status: string;
    incoming: number;
    outgoing: number;
    failed: number;
    chats: number;
    avgResponseTimeSec: number | null;
  }>;
  recentChats: Array<{
    chatId: string;
    contactName: string | null;
    sessionId: string;
    sessionName: string;
    lastMessageAt: string;
    lastDirection: string;
    messageCount: number;
  }>;
  unrepliedChats: Array<{
    chatId: string;
    contactName: string | null;
    sessionId: string;
    sessionName: string;
    lastIncomingAt: string;
    waitingSeconds: number;
    incomingCount: number;
  }>;
  failedLog: Array<{
    id: string;
    sessionId: string;
    chatId: string;
    contactName: string | null;
    to: string;
    type: string;
    body: string | null;
    createdAt: string;
    error: string | null;
  }>;
  topContacts: Array<{
    chatId: string;
    contactName: string | null;
    sessionId: string;
    sessionName: string;
    messageCount: number;
  }>;
}

/** Minimal projection of a message row used for in-memory aggregation. */
interface MsgRow {
  id: string;
  sessionId: string;
  chatId: string;
  from: string;
  to: string;
  type: string;
  body: string | null;
  direction: MessageDirection;
  status: MessageStatus;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Session, 'data')
    private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Message, 'data')
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(MessageBatch, 'data')
    private readonly batchRepo: Repository<MessageBatch>,
    @InjectRepository(SavedContact, 'data')
    private readonly savedContactRepo: Repository<SavedContact>,
  ) {}

  /**
   * Build a per-session lookup of digits-only phone number → saved contact name.
   * Used to resolve a chat's saved contact name; the frontend's shared
   * formatContactDisplay handles the phone/strip-suffix fallback.
   */
  private async buildContactNameResolver(): Promise<(sessionId: string, chatId: string) => string | null> {
    const contacts = await this.savedContactRepo.find();
    const bySession = new Map<string, Map<string, string>>();
    for (const ct of contacts) {
      if (!ct.name) continue;
      const digits = (ct.number || '').replace(/\D/g, '');
      if (!digits) continue;
      let map = bySession.get(ct.sessionId);
      if (!map) {
        map = new Map();
        bySession.set(ct.sessionId, map);
      }
      if (!map.has(digits)) map.set(digits, ct.name);
    }
    return (sessionId: string, chatId: string): string | null => {
      const local = chatId.split('@')[0];
      const digits = local.replace(/\D/g, '');
      if (!digits) return null;
      return bySession.get(sessionId)?.get(digits) ?? null;
    };
  }

  /**
   * Build the full analytics payload for a single day (defaults to "today" in
   * the server timezone). All counts are derived from real stored rows; metrics
   * that the schema cannot support are returned as { available: false }.
   */
  async getAnalytics(dateInput?: string): Promise<DashboardAnalytics> {
    const { dayStart, dayEnd, dateLabel } = this.resolveDayWindow(dateInput);

    // Sessions (all-time list; "active" = currently READY).
    const sessions = await this.sessionRepo.find();
    const sessionNames = new Map(sessions.map(s => [s.id, s.name]));
    const activeSessions = sessions.filter(s => s.status === SessionStatus.READY).length;
    const resolveContactName = await this.buildContactNameResolver();

    // Pull today's messages once and aggregate in memory. This keeps all
    // date/hour bucketing in the server's local timezone (JS Date) and avoids
    // SQLite strftime UTC/localtime ambiguity.
    const messages = (await this.messageRepo.find({
      where: { createdAt: Between(dayStart, dayEnd) },
      select: ['id', 'sessionId', 'chatId', 'from', 'to', 'type', 'body', 'direction', 'status', 'createdAt', 'metadata'],
      order: { createdAt: 'ASC' },
    })) as unknown as MsgRow[];

    const incomingVsOutgoing = { incoming: 0, outgoing: 0 };
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, incoming: 0, outgoing: 0 }));
    let failedToday = 0;
    let mediaToday = 0;

    const chats = new Set<string>();
    // Per-(session|chat) accumulator for reply/response-time analysis.
    const chatKey = (m: MsgRow) => `${m.sessionId}::${m.chatId}`;
    interface ChatAgg {
      sessionId: string;
      chatId: string;
      incoming: number;
      outgoing: number;
      messageCount: number;
      lastMessage: MsgRow;
      // reply detection state
      awaitingSince: Date | null; // set when an incoming is pending a reply
      lastIncomingAt: Date | null;
      responses: number[]; // response durations (seconds)
    }
    const chatAggs = new Map<string, ChatAgg>();
    const sessionPerf = new Map<
      string,
      { incoming: number; outgoing: number; failed: number; chats: Set<string>; responses: number[] }
    >();
    const contactCounts = new Map<string, { sessionId: string; chatId: string; count: number }>();
    const failedLog: DashboardAnalytics['failedLog'] = [];

    for (const m of messages) {
      chats.add(chatKey(m));
      const hour = m.createdAt.getHours();
      const isIncoming = m.direction === MessageDirection.INCOMING;
      if (isIncoming) {
        incomingVsOutgoing.incoming++;
        hourly[hour].incoming++;
      } else {
        incomingVsOutgoing.outgoing++;
        hourly[hour].outgoing++;
      }
      if (m.status === MessageStatus.FAILED) failedToday++;
      if (MEDIA_TYPES.has(m.type)) mediaToday++;

      // session performance
      let sp = sessionPerf.get(m.sessionId);
      if (!sp) {
        sp = { incoming: 0, outgoing: 0, failed: 0, chats: new Set(), responses: [] };
        sessionPerf.set(m.sessionId, sp);
      }
      if (isIncoming) sp.incoming++;
      else sp.outgoing++;
      if (m.status === MessageStatus.FAILED) sp.failed++;
      sp.chats.add(m.chatId);

      // contacts (by chat)
      const ck = chatKey(m);
      const cc = contactCounts.get(ck);
      if (cc) cc.count++;
      else contactCounts.set(ck, { sessionId: m.sessionId, chatId: m.chatId, count: 1 });

      // chat aggregate + reply analysis
      let agg = chatAggs.get(ck);
      if (!agg) {
        agg = {
          sessionId: m.sessionId,
          chatId: m.chatId,
          incoming: 0,
          outgoing: 0,
          messageCount: 0,
          lastMessage: m,
          awaitingSince: null,
          lastIncomingAt: null,
          responses: [],
        };
        chatAggs.set(ck, agg);
      }
      agg.messageCount++;
      agg.lastMessage = m;
      if (isIncoming) {
        agg.incoming++;
        agg.lastIncomingAt = m.createdAt;
        // Only mark the start of a new "awaiting reply" window on the first
        // incoming of a burst, so each customer burst yields one response time.
        if (!agg.awaitingSince) agg.awaitingSince = m.createdAt;
      } else {
        agg.outgoing++;
        if (agg.awaitingSince) {
          const seconds = (m.createdAt.getTime() - agg.awaitingSince.getTime()) / 1000;
          if (seconds >= 0) {
            agg.responses.push(seconds);
            sp.responses.push(seconds);
          }
          agg.awaitingSince = null;
        }
      }

      if (m.status === MessageStatus.FAILED && failedLog.length < 50) {
        failedLog.push({
          id: m.id,
          sessionId: m.sessionId,
          chatId: m.chatId,
          contactName: resolveContactName(m.sessionId, m.chatId),
          to: m.to,
          type: m.type,
          body: m.body ? m.body.slice(0, 200) : null,
          createdAt: m.createdAt.toISOString(),
          error: this.extractError(m.metadata),
        });
      }
    }

    // Reply-rate + average response time from chat aggregates.
    let chatsWithIncoming = 0;
    let repliedChats = 0;
    const allResponses: number[] = [];
    const unrepliedChats: DashboardAnalytics['unrepliedChats'] = [];
    for (const agg of chatAggs.values()) {
      if (agg.incoming > 0) {
        chatsWithIncoming++;
        if (agg.responses.length > 0) repliedChats++;
        // Still awaiting a reply after the last incoming → unreplied.
        if (agg.awaitingSince && agg.lastIncomingAt) {
          unrepliedChats.push({
            chatId: agg.chatId,
            contactName: resolveContactName(agg.sessionId, agg.chatId),
            sessionId: agg.sessionId,
            sessionName: sessionNames.get(agg.sessionId) || 'Unknown',
            lastIncomingAt: agg.lastIncomingAt.toISOString(),
            waitingSeconds: Math.max(0, Math.round((Date.now() - agg.awaitingSince.getTime()) / 1000)),
            incomingCount: agg.incoming,
          });
        }
      }
      allResponses.push(...agg.responses);
    }
    unrepliedChats.sort((a, b) => b.waitingSeconds - a.waitingSeconds);

    const avgResponseTimeSec = allResponses.length
      ? Math.round(allResponses.reduce((a, b) => a + b, 0) / allResponses.length)
      : null;
    const replyRate = chatsWithIncoming > 0 ? repliedChats / chatsWithIncoming : null;

    // Top session by message volume today.
    let topSession: DashboardAnalytics['cards']['topSession'] = null;
    for (const [sessionId, sp] of sessionPerf.entries()) {
      const total = sp.incoming + sp.outgoing;
      if (!topSession || total > topSession.messageCount) {
        topSession = { sessionId, name: sessionNames.get(sessionId) || 'Unknown', messageCount: total };
      }
    }

    // Broadcast / blaster stats from today's batches.
    const batches = await this.batchRepo.find({ where: { createdAt: Between(dayStart, dayEnd) } });
    const broadcast = { batches: batches.length, total: 0, sent: 0, failed: 0, pending: 0, cancelled: 0 };
    for (const b of batches) {
      const p = b.progress || { total: 0, sent: 0, failed: 0, pending: 0, cancelled: 0 };
      broadcast.total += p.total || 0;
      broadcast.sent += p.sent || 0;
      broadcast.failed += p.failed || 0;
      broadcast.pending += p.pending || 0;
      broadcast.cancelled += p.cancelled || 0;
    }

    // Session performance table (sorted by total volume desc).
    const sessionPerformance = Array.from(sessionPerf.entries())
      .map(([sessionId, sp]) => {
        const session = sessions.find(s => s.id === sessionId);
        return {
          sessionId,
          name: sessionNames.get(sessionId) || 'Unknown',
          status: session?.status || 'unknown',
          incoming: sp.incoming,
          outgoing: sp.outgoing,
          failed: sp.failed,
          chats: sp.chats.size,
          avgResponseTimeSec: sp.responses.length
            ? Math.round(sp.responses.reduce((a, b) => a + b, 0) / sp.responses.length)
            : null,
        };
      })
      .sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing));

    // Recent active chats (most recent last message first).
    const recentChats = Array.from(chatAggs.values())
      .sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime())
      .slice(0, 10)
      .map(agg => ({
        chatId: agg.chatId,
        contactName: resolveContactName(agg.sessionId, agg.chatId),
        sessionId: agg.sessionId,
        sessionName: sessionNames.get(agg.sessionId) || 'Unknown',
        lastMessageAt: agg.lastMessage.createdAt.toISOString(),
        lastDirection: agg.lastMessage.direction,
        messageCount: agg.messageCount,
      }));

    // Top contacts by message count.
    const topContacts = Array.from(contactCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(c => ({
        chatId: c.chatId,
        contactName: resolveContactName(c.sessionId, c.chatId),
        sessionId: c.sessionId,
        sessionName: sessionNames.get(c.sessionId) || 'Unknown',
        messageCount: c.count,
      }));

    return {
      date: dateLabel,
      generatedAt: new Date().toISOString(),
      cards: {
        activeSessions,
        incomingToday: incomingVsOutgoing.incoming,
        repliedToday: repliedChats,
        outgoingToday: incomingVsOutgoing.outgoing,
        broadcastToday: broadcast.sent,
        totalChatsToday: chats.size,
        unreadChats: {
          value: null,
          available: false,
          note: 'No per-chat unread counter is persisted. Unread state lives only in the live WhatsApp engine; the messages table has no read-by-customer field.',
        },
        failedToday,
        avgResponseTimeSec: {
          value: avgResponseTimeSec,
          available: avgResponseTimeSec !== null,
          note: avgResponseTimeSec === null ? 'No incoming→outgoing reply pairs found today.' : undefined,
        },
        replyRate: {
          value: replyRate,
          available: replyRate !== null,
          note: replyRate === null ? 'No chats with incoming messages today.' : undefined,
        },
        mediaToday,
        topSession,
      },
      hourly,
      incomingVsOutgoing,
      broadcast,
      sessionPerformance,
      recentChats,
      unrepliedChats: unrepliedChats.slice(0, 10),
      failedLog,
      topContacts,
    };
  }

  /** Resolve the [start, end] window and label for the requested day (server TZ). */
  private resolveDayWindow(dateInput?: string): { dayStart: Date; dayEnd: Date; dateLabel: string } {
    const base = dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? new Date(`${dateInput}T00:00:00`) : new Date();
    const dayStart = new Date(base);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    const y = dayStart.getFullYear();
    const mo = String(dayStart.getMonth() + 1).padStart(2, '0');
    const d = String(dayStart.getDate()).padStart(2, '0');
    return { dayStart, dayEnd, dateLabel: `${y}-${mo}-${d}` };
  }

  /** Best-effort extraction of an error string from message metadata. */
  private extractError(metadata: Record<string, unknown> | null): string | null {
    if (!metadata) return null;
    const err = (metadata.error ?? metadata.failureReason ?? metadata.errorMessage) as unknown;
    if (typeof err === 'string') return err.slice(0, 200);
    if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
      return err.message.slice(0, 200);
    }
    return null;
  }
}
