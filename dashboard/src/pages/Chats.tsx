import { useState, useEffect, useCallback, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Search,
  Send,
  Loader2,
  User,
  Users,
  AlertCircle,
  MessageSquare,
  Paperclip,
  Smile,
  X,
  CornerUpLeft,
  Trash2,
  ChevronDown,
  Funnel,
  ArrowUpDown,
  Phone,
  Clock3,
  Info,
  Mic,
  FileText,
  Film,
  Music,
  Image as ImageIcon,
} from 'lucide-react';
import {
  sessionApi,
  messageApi,
  asMessageType,
  type Session,
  type Chat,
  type ChatMessage,
  type MessageType,
} from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../components/Toast';
import './Chats.css';

type MessageMedia = { mimetype: string; filename?: string; data?: string };

// A chat as shown in the merged inbox carries the id of the channel (session) it came from, since
// the same inbox can show chats pulled from several connected WhatsApp accounts at once.
interface ChatWithSession extends Chat {
  sessionId: string;
}

interface ChatMessageView extends ChatMessage {
  metadata?: {
    media?: MessageMedia;
    quotedMessage?: { id: string; body: string };
    reactions?: Record<string, string>;
  };
}

// Delivery acks must only ADVANCE the tick, never regress it. The backend DB update is forward-only
// (ackStatusTransitionFrom), but the live websocket ack fires on every receipt (incl. pending/sent)
// and engine acks can arrive out of order or be replayed on reconnect — so a late/duplicate lower
// ack must not visually downgrade a row already shown as delivered/read. This mirrors the backend's
// transition rules exactly: pending<sent<delivered<read advances by rank; `failed` only applies from
// pending/sent (a late failure must not clobber a confirmed delivered/read), and is terminal once set.
const DELIVERY_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };
const mergeDeliveryStatus = (
  current: ChatMessageView['status'] | undefined,
  incoming: ChatMessageView['status'] | undefined,
): ChatMessageView['status'] | undefined => {
  if (!incoming) return current;
  if (!current) return incoming;
  if (current === 'failed') return 'failed'; // terminal — nothing advances from failed
  if (incoming === 'failed') return current === 'pending' || current === 'sent' ? 'failed' : current;
  if (!(incoming in DELIVERY_RANK)) return current; // unknown status — ignore
  if (!(current in DELIVERY_RANK)) return incoming;
  return DELIVERY_RANK[incoming] >= DELIVERY_RANK[current] ? incoming : current;
};

interface IncomingWsMessage {
  id: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  type: string;
  timestamp: number;
  fromMe?: boolean;
  media?: MessageMedia;
  quotedMessage?: { id: string; body: string };
  metadata?: ChatMessageView['metadata'];
}

// Map an attachment MIME type to the neutral MessageType for the optimistic outgoing bubble, so the
// placeholder matches what the backend will persist (e.g. a PDF is `document`, not `application`).
const messageTypeFromMime = (mimetype: string): MessageType => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
};

const getMediaSrc = (media?: MessageMedia): string => {
  if (!media || !media.data) return '';
  if (media.data.startsWith('data:') || media.data.startsWith('http://') || media.data.startsWith('https://')) {
    return media.data;
  }
  return `data:${media.mimetype};base64,${media.data}`;
};

// Derive an uppercase file extension from a filename for the document chip badge. Presentation
// only — does not alter the stored filename or media data.
const getFileExtension = (filename?: string): string => {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toUpperCase();
};

// If a quoted preview body is a bare media marker like "[image]", return the media kind so the UI
// can show an icon + readable label instead of literal brackets. Uses only the existing body.
const getQuotedMediaType = (body?: string): string | null => {
  if (!body) return null;
  const match = body.trim().match(/^\[(image|video|audio|voice|document|sticker)\]$/i);
  return match ? match[1].toLowerCase() : null;
};

// Turn URLs inside displayed message text into safe new-tab links. This transforms only what is
// rendered (no innerHTML, no change to the stored/sent body). `pre-wrap` on .message-text keeps
// the original line breaks in the plain-text segments.
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const renderTextWithLinks = (text: string): React.ReactNode => {
  if (!text) return text;
  return text.split(URL_PATTERN).map((segment, index) =>
    /^https?:\/\//.test(segment) ? (
      <a key={index} href={segment} target="_blank" rel="noopener noreferrer">
        {segment}
      </a>
    ) : (
      segment
    ),
  );
};

// Icon for a quoted media marker (see getQuotedMediaType). Kept here so the renderer stays tidy.
const QuotedMediaIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'image':
    case 'sticker':
      return <ImageIcon size={13} />;
    case 'video':
      return <Film size={13} />;
    case 'audio':
      return <Music size={13} />;
    case 'voice':
      return <Mic size={13} />;
    case 'document':
    default:
      return <FileText size={13} />;
  }
};

const QUOTE_MEDIA_LABELS: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Audio',
  voice: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
};

export function Chats() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.chats'));
  const { canWrite } = useRole();
  const { error: showErrorToast, warning: showWarningToast } = useToast();

  // Sessions list & active session
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);

  // Chats list — merged from every selected channel
  const [chats, setChats] = useState<ChatWithSession[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inboxView, setInboxView] = useState<'all' | 'unread' | 'direct' | 'groups'>('all');
  const [sortMode, setSortMode] = useState<'recent' | 'oldest'>('recent');

  // Channels included in the inbox: one selected shows that account's chats only, several
  // selected merge their chats together.
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [showChannelMenu, setShowChannelMenu] = useState<boolean>(false);
  const channelMenuRef = useRef<HTMLDivElement | null>(null);

  // Selected chat & message history
  const [activeChat, setActiveChat] = useState<ChatWithSession | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [messagesTotal, setMessagesTotal] = useState<number>(0); // real DB count for this chat
  const [loadingOlder, setLoadingOlder] = useState<boolean>(false); // "load older" in flight
  // Whether the oldest stored message has been loaded. Gates the "Load older" control independently
  // of message counts, so live/sent appends can't make the control disappear while older history
  // remains unloaded.
  const [reachedOldest, setReachedOldest] = useState<boolean>(false);
  const [messageInput, setMessageInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  // Channels whose chat fetch failed on the last load — surfaced non-blockingly in the inbox.
  const [failedChannelIds, setFailedChannelIds] = useState<string[]>([]);

  // Request-generation guards: only the newest load is allowed to commit state, so a slow/older
  // response from a previous channel/chat selection can never overwrite a newer one.
  const loadChatsReqRef = useRef(0);
  const loadMessagesReqRef = useRef(0);
  // Set before prepending older history so the bottom-auto-scroll effect skips that one update.
  const skipNextAutoScrollRef = useRef(false);
  // Auto-scroll control: only jump to bottom on chat-open / send, or when the user is already there.
  const isNearBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  // Mirror of `chats` + a debounce timer so an unknown-chat refresh can be triggered WITHOUT calling
  // setState inside a state updater (keeps the reducer pure).
  const chatsRef = useRef<ChatWithSession[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File attachments
  const [attachment, setAttachment] = useState<{
    file: File;
    base64: string;
    mimetype: string;
    filename: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [showInfo, setShowInfo] = useState<boolean>(false); // Chat Info drawer (presentational toggle)

  // References
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessageView | null>(null);

  // Popular emojis
  const popularEmojis = ['😀', '😂', '👍', '❤️', '🔥', '👏', '🙏', '🎉', '💡', '🤔', '😅', '😍', '😊', '😭', '😎', '😜', '🚀', '✨'];

  // 1. Fetch available connected sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        setLoadingSessions(true);
        const list = await sessionApi.list();
        const readySessions = list.filter(s => s.status === 'ready');
        setSessions(readySessions);
        if (readySessions.length > 0) {
          setSelectedSessionId(readySessions[0].id);
          setSelectedChannelIds(readySessions.map(s => s.id));
        }
      } catch (err) {
        showErrorToast(t('chats.errors.loadSessions'), err instanceof Error ? err.message : undefined);
      } finally {
        setLoadingSessions(false);
      }
    };
    void loadSessions();
  }, [t, showErrorToast]);

  // 2. Fetch chats for every selected channel and merge them into one inbox
  const loadChats = useCallback(
    async (sessionIds: string[]) => {
      const reqId = ++loadChatsReqRef.current;
      if (sessionIds.length === 0) {
        setChats([]);
        setFailedChannelIds([]);
        return;
      }
      setLoadingChats(true);
      const failed: string[] = [];
      const perChannel = await Promise.all(
        sessionIds.map(async sessionId => {
          try {
            const data = await sessionApi.getChats(sessionId);
            return data.map(chat => ({ ...chat, sessionId }));
          } catch (err) {
            failed.push(sessionId);
            showErrorToast(t('chats.errors.loadChats'), err instanceof Error ? err.message : undefined);
            return [];
          }
        }),
      );
      // A newer load started while this one was in flight — discard this (stale) result entirely.
      if (reqId !== loadChatsReqRef.current) return;
      const merged = perChannel.flat().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setChats(merged);
      setFailedChannelIds(failed);
      setLoadingChats(false);
    },
    [t, showErrorToast],
  );

  useEffect(() => {
    void loadChats(selectedChannelIds);
    setActiveChat(null);
    setMessages([]);
    setAttachment(null);
    setPreviewUrl(null);
  }, [selectedChannelIds, loadChats]);

  // Keep a non-reactive mirror of the chat list so realtime handlers can detect an unknown chat
  // without depending on `chats` (and without reading state inside a reducer).
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // Debounced refresh used when a message arrives for a chat not yet in the list. Coalesces bursts
  // into a single reload instead of fetching per message, and never runs inside a state updater.
  const scheduleChatsRefresh = useCallback(
    (sessionIds: string[]) => {
      if (refreshTimerRef.current != null) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadChats(sessionIds);
      }, 1200);
    },
    [loadChats],
  );

  // Clear any pending refresh timer on unmount.
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current != null) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const markChatRead = useCallback(
    (sessionId: string, chatId: string) => {
      void sessionApi.markChatRead(sessionId, chatId).catch(err => {
        showWarningToast(t('chats.errors.markRead'), err instanceof Error ? err.message : undefined);
      });
    },
    [t, showWarningToast],
  );

  // 3. WebSocket integration for real-time messages
  const handleIncomingMessage = useCallback(
    (event: { sessionId: string; message: Record<string, unknown> }) => {
      if (!selectedChannelIds.includes(event.sessionId)) return;

      const newMsg = event.message as unknown as IncomingWsMessage;

      // Update message list if the message belongs to the currently active chat
      if (activeChat && newMsg.chatId === activeChat.id && event.sessionId === activeChat.sessionId) {
        markChatRead(activeChat.sessionId, activeChat.id);

        const mappedMessage: ChatMessageView = {
          id: newMsg.id,
          waMessageId: newMsg.id,
          chatId: newMsg.chatId,
          from: newMsg.from,
          to: newMsg.to,
          body: newMsg.body,
          type: asMessageType(newMsg.type),
          direction: newMsg.fromMe ? 'outgoing' : 'incoming',
          status: 'sent',
          timestamp: newMsg.timestamp,
          createdAt: new Date(newMsg.timestamp * 1000).toISOString(),
          metadata: newMsg.metadata || {
            media: newMsg.media,
            quotedMessage: newMsg.quotedMessage,
          },
        };

        setMessages(prev => {
          if (prev.some(m => m.id === mappedMessage.id || m.waMessageId === mappedMessage.id)) {
            return prev;
          }
          return [...prev, mappedMessage];
        });
      }

      // An unknown chat (not yet in the list) is refreshed via a debounced reload — decided here,
      // OUTSIDE the setChats updater, so the reducer stays pure.
      const isKnownChat =
        chatsRef.current.findIndex(c => c.id === newMsg.chatId && c.sessionId === event.sessionId) !== -1;
      if (!isKnownChat) {
        scheduleChatsRefresh(selectedChannelIds);
      }

      // Update sidebar chat list (pure updater).
      setChats(prevChats => {
        const chatIndex = prevChats.findIndex(
          c => c.id === newMsg.chatId && c.sessionId === event.sessionId,
        );
        if (chatIndex === -1) {
          return prevChats; // not loaded yet — the scheduled refresh above will bring it in
        }

        const updatedChats = [...prevChats];
        const targetChat = { ...updatedChats[chatIndex] };
        targetChat.lastMessage = newMsg.body;
        targetChat.timestamp = newMsg.timestamp;

        if (!newMsg.fromMe && (!activeChat || activeChat.id !== targetChat.id || activeChat.sessionId !== event.sessionId)) {
          targetChat.unreadCount = (targetChat.unreadCount || 0) + 1;
        }

        updatedChats.splice(chatIndex, 1);
        updatedChats.unshift(targetChat);
        return updatedChats;
      });
    },
    [selectedChannelIds, activeChat, scheduleChatsRefresh, markChatRead],
  );

  const handleIncomingMessageAck = useCallback(
    (event: { sessionId: string; messageId: string; status: ChatMessageView['status'] }) => {
      if (!activeChat || event.sessionId !== activeChat.sessionId) return;

      setMessages(prev =>
        prev.map(msg => {
          if (msg.id === event.messageId || msg.waMessageId === event.messageId) {
            // Backend now sends the neutral delivery status directly (no engine-specific ack codes).
            // Merge forward-only so an out-of-order/replayed lower ack can't downgrade the tick.
            return { ...msg, status: mergeDeliveryStatus(msg.status, event.status) ?? msg.status };
          }
          return msg;
        }),
      );
    },
    [activeChat],
  );

  const handleIncomingMessageReaction = useCallback(
    (event: { sessionId: string; messageId: string; reactions: Record<string, string> }) => {
      if (!activeChat || event.sessionId !== activeChat.sessionId) return;

      setMessages(prev =>
        prev.map(msg => {
          if (msg.id === event.messageId || msg.waMessageId === event.messageId) {
            const metadata = msg.metadata || {};
            return { ...msg, metadata: { ...metadata, reactions: event.reactions } };
          }
          return msg;
        }),
      );
    },
    [activeChat],
  );

  const handleIncomingMessageRevoked = useCallback(
    (event: { sessionId: string; id: string; type: string }) => {
      if (!activeChat || event.sessionId !== activeChat.sessionId) return;

      setMessages(prev =>
        prev.map(msg => {
          if (msg.id === event.id || msg.waMessageId === event.id) {
            // The backend emits an empty body; the localized "deleted" label is rendered below.
            return { ...msg, body: '', type: asMessageType(event.type) };
          }
          return msg;
        }),
      );
    },
    [activeChat],
  );

  const { isConnected, connectionFailed, reconnect, subscribe, unsubscribe } = useWebSocket({
    onMessage: handleIncomingMessage,
    onMessageAck: handleIncomingMessageAck,
    onMessageReaction: handleIncomingMessageReaction,
    onMessageRevoked: handleIncomingMessageRevoked,
  });

  useEffect(() => {
    if (selectedChannelIds.length > 0 && isConnected) {
      selectedChannelIds.forEach(sessionId => {
        subscribe(sessionId, [
          'message.received',
          'message.sent',
          'message.ack',
          'message.reaction',
          'message.revoked',
        ]);
      });
      return () => {
        selectedChannelIds.forEach(sessionId => unsubscribe(sessionId));
      };
    }
  }, [selectedChannelIds, isConnected, subscribe, unsubscribe]);

  // Count of DB-backed messages currently shown (optimistic temp rows are not yet persisted, so
  // they must not count toward the pagination offset).
  const loadedPersistedCount = messages.reduce(
    (n, m) => (String(m.id).startsWith('temp_') ? n : n + 1),
    0,
  );

  // 4. Fetch message history for the selected chat
  const loadMessages = useCallback(
    async (sessionId: string, chatId: string) => {
      if (!sessionId || !chatId) return;
      const reqId = ++loadMessagesReqRef.current;
      setLoadingMessages(true);
      markChatRead(sessionId, chatId);
      try {
        const data = await sessionApi.getChatMessages(sessionId, chatId, 100);
        if (reqId !== loadMessagesReqRef.current) return; // chat switched mid-flight — discard
        const total = typeof data.total === 'number' ? data.total : data.messages.length;
        forceScrollRef.current = true; // opening a chat always lands at the latest message
        setMessages([...data.messages].reverse());
        setMessagesTotal(total);
        // We've loaded the newest page; older history remains only if the DB holds more than we got.
        setReachedOldest(data.messages.length >= total);
      } catch (err) {
        if (reqId !== loadMessagesReqRef.current) return;
        showErrorToast(t('chats.errors.loadMessages'), err instanceof Error ? err.message : undefined);
        setMessages([]);
        setMessagesTotal(0);
        setReachedOldest(true);
      } finally {
        if (reqId === loadMessagesReqRef.current) setLoadingMessages(false);
      }
    },
    [markChatRead, t, showErrorToast],
  );

  // Append the next older page of history (uses the backend's existing offset paging). The offset is
  // the count of PERSISTED messages loaded (excludes optimistic temp rows), so live/sent appends
  // don't skew it. Older messages are prepended and de-duplicated, preserving chronological order.
  const loadOlderMessages = useCallback(async () => {
    if (!activeChat || loadingOlder || loadingMessages || reachedOldest) return;
    const reqId = loadMessagesReqRef.current; // tie this page to the current chat's load generation
    const { sessionId, id: chatId } = activeChat;
    const offset = loadedPersistedCount; // count of non-temp (DB-backed) messages currently shown
    setLoadingOlder(true);
    try {
      const data = await sessionApi.getChatMessages(sessionId, chatId, 100, offset);
      if (reqId !== loadMessagesReqRef.current) return; // chat switched — discard
      if (data.messages.length === 0) {
        setReachedOldest(true); // no more stored history
        return;
      }
      const older = [...data.messages].reverse(); // oldest-first
      skipNextAutoScrollRef.current = true; // don't yank the view to the bottom when prepending
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.waMessageId || m.id));
        const deduped = older.filter(m => !seen.has(m.waMessageId || m.id));
        if (deduped.length === 0) {
          skipNextAutoScrollRef.current = false; // nothing prepended — don't swallow a later scroll
          return prev;
        }
        return [...deduped, ...prev];
      });
      if (typeof data.total === 'number') setMessagesTotal(prev => Math.max(prev, data.total));
      // A short page means we've reached the start of stored history.
      if (data.messages.length < 100) setReachedOldest(true);
    } catch (err) {
      showErrorToast(t('chats.errors.loadMessages'), err instanceof Error ? err.message : undefined);
    } finally {
      setLoadingOlder(false);
    }
  }, [activeChat, loadedPersistedCount, loadingOlder, loadingMessages, reachedOldest, t, showErrorToast]);

  const handleReactMessage = async (msg: ChatMessageView, emoji: string) => {
    if (!activeChat) return;

    const msgId = msg.waMessageId || msg.id;
    const currentReactions = msg.metadata?.reactions || {};
    const sessionPhone = sessions.find(s => s.id === activeChat.sessionId)?.phone || 'me';

    let alreadyReacted = false;
    for (const [sender, emo] of Object.entries(currentReactions)) {
      if ((sender === 'me' || sender.includes(sessionPhone)) && emo === emoji) {
        alreadyReacted = true;
        break;
      }
    }

    const emojiToSend = alreadyReacted ? '' : emoji;

    try {
      await messageApi.react(activeChat.sessionId, {
        chatId: activeChat.id,
        messageId: msgId,
        emoji: emojiToSend,
      });

      setMessages(prev =>
        prev.map(m => {
          if (m.id === msg.id || m.waMessageId === msg.id) {
            const metadata = m.metadata || {};
            const reactions = { ...(metadata.reactions || {}) };
            if (emojiToSend === '') {
              delete reactions['me'];
            } else {
              reactions['me'] = emojiToSend;
            }
            return { ...m, metadata: { ...metadata, reactions } };
          }
          return m;
        }),
      );
    } catch (err) {
      showErrorToast(t('chats.errors.react'), err instanceof Error ? err.message : undefined);
    }
  };

  const handleDeleteMessage = async (msg: ChatMessageView) => {
    if (!activeChat) return;
    const msgId = msg.waMessageId || msg.id;

    if (!window.confirm(t('chats.deleteConfirm'))) return;

    try {
      await messageApi.delete(activeChat.sessionId, {
        chatId: activeChat.id,
        messageId: msgId,
        forEveryone: true,
      });

      setMessages(prev =>
        prev.map(m => {
          if (m.id === msg.id || m.waMessageId === msg.id) {
            return { ...m, body: '', type: 'revoked' };
          }
          return m;
        }),
      );
    } catch (err) {
      showErrorToast(t('chats.errors.delete'), err instanceof Error ? err.message : undefined);
    }
  };

  useEffect(() => {
    if (activeChat) {
      void loadMessages(activeChat.sessionId, activeChat.id);
      setChats(prev =>
        prev.map(c =>
          c.id === activeChat.id && c.sessionId === activeChat.sessionId ? { ...c, unreadCount: 0 } : c,
        ),
      );
    } else {
      setMessages([]);
      setMessagesTotal(0);
    }
  }, [activeChat, loadMessages]);

  // Esc closes the Chat Info drawer.
  useEffect(() => {
    if (!showInfo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowInfo(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showInfo]);

  // Drop the drawer if the conversation is cleared (e.g. channel switch).
  useEffect(() => {
    if (!activeChat) setShowInfo(false);
  }, [activeChat]);

  // Close the channel filter dropdown when clicking outside of it
  useEffect(() => {
    if (!showChannelMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (channelMenuRef.current && !channelMenuRef.current.contains(e.target as Node)) {
        setShowChannelMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showChannelMenu]);

  const toggleChannelSelection = (sessionId: string) => {
    setSelectedChannelIds(prev => {
      if (prev.includes(sessionId)) {
        if (prev.length === 1) return prev; // always keep at least one channel selected
        return prev.filter(id => id !== sessionId);
      }
      return [...prev, sessionId];
    });
  };

  // 5. Auto-scroll to bottom only when appropriate: on chat-open / send (forceScrollRef), or when
  // the user is already near the bottom. If they've scrolled up to read history, don't yank them
  // down on acks/reactions/incoming. Prepending older history is skipped entirely.
  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (forceScrollRef.current || isNearBottomRef.current) {
      forceScrollRef.current = false;
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Track whether the message view is scrolled near the bottom (drives the auto-scroll decision).
  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // 6. Handle file selection & base64 conversion
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }

    const reader = new FileReader();
    reader.onload = event => {
      const dataUrl = event.target?.result as string;
      const base64Data = dataUrl.split(',')[1];
      setAttachment({ file, base64: base64Data, mimetype: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAttachment = () => {
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleEmojiClick = (emoji: string) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // 7. Handle sending a message / media
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChat || sending) return;

    const textToSend = messageInput.trim();
    if (!textToSend && !attachment) return;

    setMessageInput('');
    setSending(true);

    const tempId = `temp_${Date.now()}`;
    const tempMessage: ChatMessageView = {
      id: tempId,
      chatId: activeChat.id,
      from: 'me',
      to: activeChat.id,
      body: attachment
        ? attachment.mimetype.startsWith('image/') ||
          attachment.mimetype.startsWith('video/') ||
          attachment.mimetype.startsWith('audio/')
          ? textToSend
          : attachment.filename
        : textToSend,
      type: attachment ? messageTypeFromMime(attachment.mimetype) : 'text',
      direction: 'outgoing',
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: attachment
        ? {
            media: {
              mimetype: attachment.mimetype,
              filename: attachment.filename,
              data: attachment.base64,
            },
          }
        : replyingTo
          ? {
              quotedMessage: {
                id: replyingTo.waMessageId || replyingTo.id,
                body: replyingTo.type !== 'text' ? `[${replyingTo.type}]` : replyingTo.body,
              },
            }
          : undefined,
    };

    forceScrollRef.current = true; // sending always scrolls the composer's message into view
    setMessages(prev => [...prev, tempMessage]);

    const currentAttachment = attachment;
    const currentReplyingTo = replyingTo;
    handleRemoveAttachment();
    setReplyingTo(null);

    try {
      let result;

      if (currentAttachment) {
        let mediaType: 'image' | 'video' | 'audio' | 'document' = 'document';
        const mime = currentAttachment.mimetype;
        if (mime.startsWith('image/')) mediaType = 'image';
        else if (mime.startsWith('video/')) mediaType = 'video';
        else if (mime.startsWith('audio/')) mediaType = 'audio';

        result = await messageApi.sendMedia(activeChat.sessionId, activeChat.id, mediaType, {
          base64: currentAttachment.base64,
          mimetype: currentAttachment.mimetype,
          filename: currentAttachment.filename,
          caption: mediaType !== 'audio' ? textToSend : undefined,
        });
      } else if (currentReplyingTo) {
        result = await messageApi.reply(activeChat.sessionId, {
          chatId: activeChat.id,
          quotedMessageId: currentReplyingTo.waMessageId || currentReplyingTo.id,
          text: textToSend,
        });
      } else {
        result = await messageApi.sendText(activeChat.sessionId, activeChat.id, textToSend);
      }

      setMessages(prev => {
        // Race guard: the realtime `message.sent` echo can arrive before this response and already
        // append the message by its real WA id (the dedup at receive time misses because the
        // optimistic placeholder still carries the temp id). If so, drop the placeholder instead of
        // renaming it — otherwise both the echo and the renamed temp render as duplicate bubbles.
        const echoAlreadyAdded = prev.some(m => m.id === result.messageId || m.waMessageId === result.messageId);
        if (echoAlreadyAdded) {
          return prev.filter(m => m.id !== tempId);
        }
        return prev.map(m =>
          m.id === tempId ? { ...m, id: result.messageId, waMessageId: result.messageId, status: 'sent' } : m,
        );
      });

      // Update sidebar chat list (move active chat to the top with the new snippet)
      setChats(prevChats => {
        const chatIndex = prevChats.findIndex(c => c.id === activeChat.id);
        if (chatIndex === -1) return prevChats;
        const updatedChats = [...prevChats];
        const target = { ...updatedChats[chatIndex] };
        target.lastMessage = currentAttachment
          ? `[${currentAttachment.mimetype.split('/')[0]}]`
          : textToSend;
        target.timestamp = Math.floor(Date.now() / 1000);
        updatedChats.splice(chatIndex, 1);
        updatedChats.unshift(target);
        return updatedChats;
      });
    } catch (err) {
      showErrorToast(t('chats.errors.send'), err instanceof Error ? err.message : undefined);
      setMessages(prev => prev.map(m => (m.id === tempId ? { ...m, status: 'failed' } : m)));
    } finally {
      setSending(false);
    }
  };

  // Helper formats
  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLastMessageSnippet = (chat: Chat) => chat.lastMessage || '';
  const totalUnread = chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
  const directChats = chats.filter(chat => !chat.isGroup).length;
  const groupChats = chats.filter(chat => chat.isGroup).length;
  const activeChatMessageCount = messages.length;
  const activeChatUnread = activeChat?.unreadCount || 0;

  // Stats computed from the loaded messages only (no fetch). Surfaced in the Chat Info drawer.
  const messageStats = messages.reduce(
    (acc, m) => {
      if (m.direction === 'outgoing') acc.outgoing += 1;
      else acc.incoming += 1;
      if (m.type !== 'text' && m.type !== 'revoked') acc.media += 1;
      return acc;
    },
    { incoming: 0, outgoing: 0, media: 0 },
  );

  // Phone number for a 1:1 chat is encoded in the JID (e.g. 1234567890@c.us). Groups have no number.
  const activeChatPhone =
    activeChat && !activeChat.isGroup ? activeChat.id.split('@')[0] : '';

  // The channel the active chat actually belongs to (multi-channel safe — not the rail selector).
  const activeChatSession = activeChat ? sessions.find(s => s.id === activeChat.sessionId) || null : null;
  const selectedChannelName = activeChatSession?.name || 'Session';
  const activeChannelPhone = activeChatSession?.phone || '';

  const formatChatTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return t('chats.yesterday');
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const filteredChats = chats
    .filter(chat => {
      const matchesSearch =
        chat.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.id.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (inboxView === 'unread') return (chat.unreadCount || 0) > 0;
      if (inboxView === 'direct') return !chat.isGroup;
      if (inboxView === 'groups') return chat.isGroup;
      return true;
    })
    .sort((a, b) => {
      const aTime = a.timestamp || 0;
      const bTime = b.timestamp || 0;
      return sortMode === 'recent' ? bTime - aTime : aTime - bTime;
    });


  return (
    <div className="chats-page">
      {/* Real-time connection permanently dropped — let the user re-establish it instead of
          silently showing stale chats. */}
      {connectionFailed && (
        <div className="chats-reconnect-banner" role="alert">
          <AlertCircle size={16} />
          <span>{t('common.disconnected')}</span>
          <button className="btn-secondary" onClick={reconnect}>
            {t('common.refresh')}
          </button>
        </div>
      )}

      {loadingSessions ? (
        <div className="chats-loading-container">
          <Loader2 className="animate-spin" size={32} />
          <p>{t('common.loading')}</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="chats-error-state">
          <AlertCircle size={48} className="text-warn" />
          <h3>{t('chats.noSessionsTitle')}</h3>
          <p>
            <Trans i18nKey="chats.noSessionsDesc">
              Please connect a WhatsApp session from the <strong>Sessions</strong> menu first to use the chat
              feature.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="chats-layout">
          <aside className="chats-iconbar">
            <div className="chats-iconbar-logo" title="Workspace">
              <MessageSquare size={20} />
            </div>
            <nav className="chats-iconbar-nav">
              <button
                type="button"
                className={`chats-iconbar-btn ${inboxView === 'all' ? 'active' : ''}`}
                onClick={() => setInboxView('all')}
                title="All conversations"
                aria-label="All conversations"
              >
                <MessageSquare size={20} />
                {filteredChats.length > 0 && (
                  <span className="chats-iconbar-count">{filteredChats.length}</span>
                )}
              </button>
              <button
                type="button"
                className={`chats-iconbar-btn ${inboxView === 'unread' ? 'active' : ''}`}
                onClick={() => setInboxView('unread')}
                title="Unread"
                aria-label="Unread"
              >
                <Clock3 size={20} />
                {totalUnread > 0 && <span className="chats-iconbar-count alert">{totalUnread}</span>}
              </button>
              <button
                type="button"
                className={`chats-iconbar-btn ${inboxView === 'direct' ? 'active' : ''}`}
                onClick={() => setInboxView('direct')}
                title="Direct"
                aria-label="Direct"
              >
                <Phone size={20} />
                {directChats > 0 && <span className="chats-iconbar-count">{directChats}</span>}
              </button>
              <button
                type="button"
                className={`chats-iconbar-btn ${inboxView === 'groups' ? 'active' : ''}`}
                onClick={() => setInboxView('groups')}
                title="Groups"
                aria-label="Groups"
              >
                <Users size={20} />
                {groupChats > 0 && <span className="chats-iconbar-count">{groupChats}</span>}
              </button>
            </nav>
            <div className="chats-iconbar-foot">
              <span
                className={`chats-iconbar-dot ${isConnected ? 'online' : 'syncing'}`}
                title={isConnected ? 'Connected' : 'Reconnecting'}
              />
            </div>
          </aside>

          <section className="chats-inbox">
            <div className="chats-inbox-header">
              <select
                value={selectedSessionId}
                onChange={e => setSelectedSessionId(e.target.value)}
                className="chats-workspace-select"
                title="Active workspace"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.phone || t('chats.noPhone')})
                  </option>
                ))}
              </select>
              <div className="chats-channel-filter" ref={channelMenuRef}>
                <button
                  type="button"
                  className="chats-inbox-channel"
                  onClick={() => setShowChannelMenu(v => !v)}
                >
                  {selectedChannelIds.length === sessions.length
                    ? 'All channels'
                    : `${selectedChannelIds.length} channel${selectedChannelIds.length === 1 ? '' : 's'}`}
                  <ChevronDown size={16} />
                </button>
                {showChannelMenu && (
                  <div className="chats-channel-menu">
                    <div className="chats-channel-menu-header">
                      <span>All channels</span>
                      <span>{sessions.length}</span>
                    </div>
                    {sessions.map(s => {
                      const checked = selectedChannelIds.includes(s.id);
                      return (
                        <label key={s.id} className="chats-channel-menu-item">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleChannelSelection(s.id)}
                          />
                          <span className="chats-channel-menu-name">{s.name}</span>
                          <span className="chats-channel-menu-phone">{s.phone || t('chats.noPhone')}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="chats-inbox-toolbar">
              <div className="chat-search-input">
                <Search size={18} />
                <input
                  type="text"
                  placeholder={t('chats.searchPlaceholder')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={`chats-toolbar-chip ${inboxView === 'all' ? 'active' : ''}`}
                onClick={() => setInboxView('all')}
              >
                Open
              </button>
              <button
                type="button"
                className="chats-toolbar-chip"
                onClick={() => setSortMode(current => (current === 'recent' ? 'oldest' : 'recent'))}
              >
                <ArrowUpDown size={15} />
                {sortMode === 'recent' ? 'Recent first' : 'Started first'}
              </button>
              <button type="button" className="chats-toolbar-icon" aria-label="Filters">
                <Funnel size={16} />
              </button>
            </div>

            {/* Non-blocking notice: a selected channel failed to load — the rest still show. */}
            {failedChannelIds.length > 0 && (
              <div className="chats-channel-warning" role="status">
                <AlertCircle size={14} />
                <span>
                  {t('chats.channelLoadFailed', {
                    defaultValue: "Couldn't load {{names}}. Showing the other channels.",
                    names: failedChannelIds
                      .map(fid => sessions.find(s => s.id === fid)?.name || fid)
                      .join(', '),
                  })}
                </span>
                <button type="button" onClick={() => void loadChats(selectedChannelIds)}>
                  {t('common.refresh')}
                </button>
              </div>
            )}

            <div className="chats-list">
              {loadingChats ? (
                <div className="chats-list-loading">
                  <Loader2 className="animate-spin" size={24} />
                  <span>{t('chats.loadingChats')}</span>
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="chats-list-empty">
                  <MessageSquare size={40} className="placeholder-icon" />
                  <span>{t('chats.empty')}</span>
                </div>
              ) : (
                filteredChats.map(chat => {
                  // Identity is per-channel: the same contact/group can exist on multiple WhatsApp
                  // accounts, so both the key and the active check combine sessionId + chat.id.
                  const isActive = activeChat?.id === chat.id && activeChat?.sessionId === chat.sessionId;
                  return (
                    <div
                      key={`${chat.sessionId}:${chat.id}`}
                      className={`chat-item-card ${isActive ? 'active' : ''} ${
                        (chat.unreadCount || 0) > 0 ? 'has-unread' : ''
                      }`}
                      onClick={() => setActiveChat(chat)}
                    >
                      <div className="chat-avatar">
                        {chat.isGroup ? <Users size={20} /> : <User size={20} />}
                      </div>

                      <div className="chat-item-info">
                        <div className="chat-item-top">
                          <span className="chat-item-name" title={chat.name || chat.id}>
                            {chat.name || chat.id.split('@')[0]}
                          </span>
                          {chat.timestamp && (
                            <span className="chat-item-time">{formatChatTime(chat.timestamp)}</span>
                          )}
                        </div>
                        <div className="chat-item-bottom">
                          <span className="chat-item-snippet" title={formatLastMessageSnippet(chat)}>
                            {formatLastMessageSnippet(chat) || (
                              <span className="no-message">{t('chats.noMessageYet')}</span>
                            )}
                          </span>
                          <div className="chat-item-badges">
                            <span className={`chat-type-badge ${chat.isGroup ? 'group' : 'direct'}`}>
                              {chat.isGroup ? 'Group' : 'Direct'}
                            </span>
                            {chat.unreadCount > 0 && (
                              <span className="chat-unread-badge">{chat.unreadCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <main className="chats-room">
            {activeChat ? (
              <>
              <div className="room-container">
                <header className="room-header">
                  <div className="room-header-main">
                    <div className="room-avatar">
                      {activeChat.isGroup ? <Users size={20} /> : <User size={20} />}
                    </div>
                    <div className="room-contact-info">
                      <h3>{activeChat.name || activeChat.id.split('@')[0]}</h3>
                      <span>{activeChat.id}</span>
                      <div className="room-contact-meta">
                        <span className={isConnected ? 'meta-ok' : 'meta-warn'}>
                          {isConnected ? 'Connected' : 'Waiting for sync'}
                        </span>
                        <span>{activeChat.isGroup ? 'Group' : 'Direct'}</span>
                        <span>{selectedChannelName}</span>
                      </div>
                    </div>
                  </div>
                  <div className="room-header-actions">
                    <button
                      type="button"
                      className={`room-info-btn ${showInfo ? 'active' : ''}`}
                      title="Chat info"
                      aria-label="Chat info"
                      aria-expanded={showInfo}
                      onClick={() => setShowInfo(v => !v)}
                    >
                      <Info size={18} />
                    </button>
                  </div>
                </header>

                <div className="room-messages" onScroll={handleMessagesScroll}>
                  {!loadingMessages && messages.length > 0 && !reachedOldest && (
                    <div className="load-older-row">
                      <button
                        type="button"
                        className="load-older-btn"
                        onClick={() => void loadOlderMessages()}
                        disabled={loadingOlder}
                      >
                        {loadingOlder ? (
                          <>
                            <Loader2 className="animate-spin" size={14} />
                            {t('chats.loadingMessages')}
                          </>
                        ) : (
                          t('chats.loadOlder', { defaultValue: 'Load older messages' })
                        )}
                      </button>
                    </div>
                  )}
                  {loadingMessages ? (
                    <div className="messages-loading">
                      <Loader2 className="animate-spin" size={32} />
                      <span>{t('chats.loadingMessages')}</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="messages-empty">
                      <MessageSquare size={32} />
                      <span>{t('chats.noMessagesInChat')}</span>
                    </div>
                  ) : (
                    messages.map(msg => {
                      const isMe = msg.direction === 'outgoing';
                      const formattedTime = formatTime(
                        msg.timestamp || Math.floor(new Date(msg.createdAt).getTime() / 1000),
                      );

                      const isMediaMessage = msg.type !== 'text';
                      const mediaInfo = msg.metadata?.media;

                      const renderMedia = () => {
                        if (msg.type === 'revoked') return null;
                        if (!mediaInfo) return null;
                        const mediaSrc = getMediaSrc(mediaInfo);
                        if (!mediaSrc) return null;

                        switch (msg.type) {
                          case 'sticker':
                            return (
                              <div className="message-media-sticker">
                                <img
                                  src={mediaSrc}
                                  alt={mediaInfo.filename || 'Sticker'}
                                  className="chat-sticker-media"
                                />
                              </div>
                            );
                          case 'image':
                            return (
                              <div className="message-media-image">
                                <img
                                  src={mediaSrc}
                                  alt={mediaInfo.filename || 'WhatsApp Image'}
                                  className="chat-image-media"
                                />
                              </div>
                            );
                          case 'video':
                            return (
                              <div className="message-media-video">
                                <video src={mediaSrc} controls className="chat-video-media" />
                              </div>
                            );
                          case 'voice':
                            return (
                              <div className="message-media-voice">
                                <span className="voice-mic" aria-hidden="true">
                                  <Mic size={16} />
                                </span>
                                <audio src={mediaSrc} controls className="chat-audio-media" />
                              </div>
                            );
                          case 'audio':
                            return (
                              <div className="message-media-audio">
                                <audio src={mediaSrc} controls className="chat-audio-media" />
                              </div>
                            );
                          case 'document':
                          default: {
                            const ext = getFileExtension(mediaInfo.filename);
                            return (
                              <div className="message-media-document">
                                <a
                                  href={mediaSrc}
                                  download={mediaInfo.filename || 'document'}
                                  className="chat-document-media"
                                >
                                  <span className="doc-icon">
                                    <FileText size={20} />
                                    {ext && <span className="doc-ext">{ext}</span>}
                                  </span>
                                  <span className="doc-info">
                                    <span className="doc-name">
                                      {mediaInfo.filename || t('chats.downloadDocument')}
                                    </span>
                                    <span className="doc-sub">
                                      {ext ? `${ext} file` : t('chats.downloadDocument')}
                                    </span>
                                  </span>
                                </a>
                              </div>
                            );
                          }
                        }
                      };

                      const reactions = msg.metadata?.reactions || {};
                      const hasReactions = Object.keys(reactions).length > 0;
                      const isRevoked = msg.type === 'revoked';
                      const quotedBody = msg.metadata?.quotedMessage?.body;
                      const quotedMediaType = getQuotedMediaType(quotedBody);

                      return (
                        <div
                          key={msg.id}
                          className={`message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`}
                        >
                          <div className="message-bubble-container">
                            <div
                              className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} ${msg.status} ${
                                isMediaMessage ? 'media-type' : ''
                              } ${msg.type === 'sticker' ? 'sticker-type' : ''} ${
                                isRevoked ? 'revoked-type' : ''
                              }`}
                            >
                              {/* Quoted message display */}
                              {msg.metadata?.quotedMessage && (
                                <div className="message-quote-box">
                                  {quotedMediaType ? (
                                    <div className="quote-media-label">
                                      <QuotedMediaIcon type={quotedMediaType} />
                                      <span>{QUOTE_MEDIA_LABELS[quotedMediaType] || quotedMediaType}</span>
                                    </div>
                                  ) : (
                                    <div className="quote-body">{quotedBody}</div>
                                  )}
                                </div>
                              )}

                              {(() => {
                                const renderedMedia = renderMedia();
                                const hasTextBody =
                                  !!msg.body && (!mediaInfo || msg.body !== mediaInfo.filename);

                                if (isRevoked) {
                                  return <div className="message-text">{t('chats.messageDeleted')}</div>;
                                }
                                if (renderedMedia || hasTextBody) {
                                  return (
                                    <>
                                      {renderedMedia}
                                      {hasTextBody && (
                                        <div className="message-text">{renderTextWithLinks(msg.body)}</div>
                                      )}
                                    </>
                                  );
                                }
                                // Only reached when there's truly no media and no text to show
                                // (e.g. media payload missing/unfetched for a non-text type).
                                return (
                                  <div className="message-text message-unsupported">
                                    {t('chats.unsupportedMessage', { defaultValue: 'Unsupported message type' })}
                                  </div>
                                );
                              })()}

                              <div className="message-meta">
                                <span className="message-time">{formattedTime}</span>
                                {isMe && (
                                  <span className={`message-status-icon ${msg.status}`}>
                                    {msg.status === 'pending' && '🕒'}
                                    {msg.status === 'sent' && '✓'}
                                    {msg.status === 'delivered' && '✓✓'}
                                    {msg.status === 'read' && '✓✓'}
                                    {msg.status === 'failed' && '⚠️'}
                                  </span>
                                )}
                              </div>

                              {/* Reactions display */}
                              {hasReactions && (
                                <div className="message-reactions-badge">
                                  {Object.values(reactions)
                                    .slice(0, 3)
                                    .map((emoji, idx) => (
                                      <span key={idx} className="reaction-emoji-span">
                                        {emoji}
                                      </span>
                                    ))}
                                  {Object.keys(reactions).length > 1 && (
                                    <span className="reactions-count-span">
                                      {Object.keys(reactions).length}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Message actions menu (hover) */}
                            {!isRevoked && (
                              <div className="message-actions-menu">
                                <button
                                  type="button"
                                  className="action-btn"
                                  onClick={() => setReplyingTo(msg)}
                                  title={t('chats.actions.reply')}
                                >
                                  <CornerUpLeft size={14} />
                                </button>

                                <div className="reaction-trigger-wrapper">
                                  <button
                                    type="button"
                                    className="action-btn reaction-btn"
                                    title={t('chats.actions.react')}
                                  >
                                    <Smile size={14} />
                                  </button>
                                  <div className="reaction-quick-popover">
                                    {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => handleReactMessage(msg, emoji)}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {isMe && msg.status !== 'pending' && (
                                  <button
                                    type="button"
                                    className="action-btn delete-btn"
                                    onClick={() => handleDeleteMessage(msg)}
                                    title={t('chats.actions.delete')}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Attachment preview banner */}
                {attachment && (
                  <div className="attachment-preview-banner">
                    {previewUrl ? (
                      <img src={previewUrl} alt={attachment.filename} className="preview-thumbnail" />
                    ) : (
                      <div className="preview-file-icon">📎</div>
                    )}
                    <div className="preview-file-info">
                      <span className="preview-filename">{attachment.filename}</span>
                      <span className="preview-filesize">({(attachment.file.size / 1024).toFixed(1)} KB)</span>
                    </div>
                    <button className="btn-remove-attachment" onClick={handleRemoveAttachment}>
                      <X size={18} />
                    </button>
                  </div>
                )}

                {/* Popular emojis panel */}
                {showEmojiPicker && (
                  <div className="chats-emoji-picker">
                    <div className="emoji-grid">
                      {popularEmojis.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          className="emoji-btn"
                          onClick={() => handleEmojiClick(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Replying preview banner */}
                {replyingTo && (
                  <div className="replying-preview-banner">
                    <div className="replying-preview-content">
                      <div className="replying-to-title">
                        {t('chats.replyingTo', {
                          name:
                            replyingTo.direction === 'outgoing'
                              ? t('chats.you')
                              : activeChat.name || activeChat.id.split('@')[0],
                        })}
                      </div>
                      <div className="replying-to-body">
                        {replyingTo.type !== 'text' ? `[${replyingTo.type}]` : replyingTo.body}
                      </div>
                    </div>
                    <button className="btn-close-reply" onClick={() => setReplyingTo(null)}>
                      <X size={18} />
                    </button>
                  </div>
                )}

                {/* Message input bar */}
                <footer className="room-input-footer">
                  <form onSubmit={handleSend} className="input-form">
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />

                    <button
                      type="button"
                      onClick={triggerFileSelect}
                      disabled={!canWrite || sending}
                      className="btn-input-accessory"
                      title={t('chats.attachTitle')}
                    >
                      <Paperclip size={20} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      disabled={!canWrite || sending}
                      className={`btn-input-accessory ${showEmojiPicker ? 'active' : ''}`}
                      title={t('chats.emojiTitle')}
                    >
                      <Smile size={20} />
                    </button>

                    <input
                      type="text"
                      placeholder={
                        canWrite
                          ? attachment
                            ? t('chats.captionPlaceholder')
                            : t('chats.messagePlaceholder')
                          : t('chats.noPermission')
                      }
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      disabled={!canWrite || sending}
                      className="message-text-input"
                    />
                    {/* Presentational placeholder for future voice messages — always disabled, no handler. */}
                    <button
                      type="button"
                      disabled
                      className="btn-input-accessory btn-mic-future"
                      title="Voice messages — coming soon"
                      aria-label="Voice message (coming soon)"
                    >
                      <Mic size={20} />
                    </button>
                    <button
                      type="submit"
                      disabled={!canWrite || (!messageInput.trim() && !attachment) || sending}
                      className="btn-send-message"
                      aria-label={t('chats.send')}
                    >
                      {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                    </button>
                  </form>
                </footer>
              </div>

              {/* Chat Info drawer — right-side glass panel built entirely from in-memory data. */}
              {showInfo && (
                <>
                  <div className="chat-info-scrim" onClick={() => setShowInfo(false)} aria-hidden="true" />
                  <aside className="chat-info-drawer" role="dialog" aria-label="Chat info">
                    <div className="chat-info-header">
                      <span className="chat-info-title">Chat info</span>
                      <button
                        type="button"
                        className="chat-info-close"
                        onClick={() => setShowInfo(false)}
                        aria-label="Close chat info"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <div className="chat-info-body">
                      <div className="chat-info-identity">
                        <div className="chat-info-avatar">
                          {activeChat.isGroup ? <Users size={26} /> : <User size={26} />}
                        </div>
                        <div className="chat-info-name">{activeChat.name || activeChat.id.split('@')[0]}</div>
                        <span className={`chat-info-type ${activeChat.isGroup ? 'group' : 'direct'}`}>
                          {activeChat.isGroup ? 'Group chat' : 'Direct chat'}
                        </span>
                      </div>

                      <div className="chat-info-section">
                        <div className="chat-info-section-title">Details</div>
                        <div className="chat-info-row">
                          <span>Chat ID</span>
                          <strong className="mono" title={activeChat.id}>{activeChat.id}</strong>
                        </div>
                        {!activeChat.isGroup && (
                          <div className="chat-info-row">
                            <span>Phone number</span>
                            <strong className="mono">{activeChatPhone || '—'}</strong>
                          </div>
                        )}
                        <div className="chat-info-row">
                          <span>Type</span>
                          <strong>{activeChat.isGroup ? 'Group' : 'Direct'}</strong>
                        </div>
                        <div className="chat-info-row">
                          <span>Last activity</span>
                          <strong>{activeChat.timestamp ? formatChatTime(activeChat.timestamp) : '—'}</strong>
                        </div>
                        <div className="chat-info-row">
                          <span>Unread</span>
                          <strong>{activeChatUnread}</strong>
                        </div>
                      </div>

                      <div className="chat-info-section">
                        <div className="chat-info-section-title">Channel</div>
                        <div className="chat-info-row">
                          <span>Session</span>
                          <strong>{selectedChannelName}</strong>
                        </div>
                        <div className="chat-info-row">
                          <span>Session phone</span>
                          <strong className="mono">{activeChannelPhone || t('chats.noPhone')}</strong>
                        </div>
                        <div className="chat-info-row">
                          <span>Connection</span>
                          <strong className={isConnected ? 'ok' : 'warn'}>
                            {isConnected ? 'Connected' : 'Reconnecting'}
                          </strong>
                        </div>
                      </div>

                      <div className="chat-info-section">
                        <div className="chat-info-section-title">Messages</div>
                        <div className="chat-info-stats">
                          <div className="chat-info-stat">
                            <strong>{activeChatMessageCount}</strong>
                            <span>Loaded</span>
                          </div>
                          <div className="chat-info-stat">
                            <strong>{Math.max(messagesTotal, activeChatMessageCount)}</strong>
                            <span>Total</span>
                          </div>
                          <div className="chat-info-stat">
                            <strong>{messageStats.incoming}</strong>
                            <span>Incoming</span>
                          </div>
                          <div className="chat-info-stat">
                            <strong>{messageStats.outgoing}</strong>
                            <span>Outgoing</span>
                          </div>
                          <div className="chat-info-stat">
                            <strong>{messageStats.media}</strong>
                            <span>Media</span>
                          </div>
                        </div>
                        <div className="chat-info-note">Stats reflect loaded messages only.</div>
                      </div>

                      <div className="chat-info-section">
                        <div className="chat-info-section-title">Labels</div>
                        <div className="chat-info-empty">Labels are not available yet.</div>
                      </div>
                    </div>
                  </aside>
                </>
              )}
              </>
            ) : (
              <div className="chats-room-placeholder">
                <div className="chats-room-placeholder-orb">
                  <MessageSquare size={80} className="placeholder-icon" />
                </div>
                <h2>Select a conversation</h2>
                <p>Pick a thread from the inbox to start replying, reviewing context, and handling WhatsApp chats faster.</p>
                <div className="chats-placeholder-grid">
                  <div className="chats-placeholder-card">
                    <strong>Pick a conversation</strong>
                    <span>Use the center column to scan unread threads, recent activity, and group chats.</span>
                  </div>
                  <div className="chats-placeholder-card">
                    <strong>Reply with context</strong>
                    <span>Keep replies, reactions, attachments, and customer history in one focused pane.</span>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
