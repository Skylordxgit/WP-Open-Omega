import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Search,
  Send,
  Loader2,
  ChevronDown,
  Check,
  Info,
  User,
  Users,
  AlertCircle,
  MessageSquare,
  Paperclip,
  Smile,
  X,
  CornerUpLeft,
  Trash2,
  ArrowUpDown,
  Phone,
  Wifi,
  Clock3,
} from 'lucide-react';
import {
  contactApi,
  labelApi,
  sessionApi,
  messageApi,
  asMessageType,
  type Session,
  type Chat,
  type ChatMessage,
  type LiveChatHistoryMessage,
  type MessageType,
  type SavedContactRecord,
  type ChatLabel,
} from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../components/Toast';
import './Chats.css';

type MessageMedia = { mimetype: string; filename?: string; data?: string };

interface ChatMessageView extends ChatMessage {
  metadata?: {
    media?: MessageMedia;
    quotedMessage?: { id: string; body: string };
    reactions?: Record<string, string>;
  };
}

interface InboxChat extends Chat {
  sessionId: string;
  sessionName: string;
  sessionPhone?: string;
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

const looksLikeBase64Payload = (value: string) =>
  value.length > 120 && /^[A-Za-z0-9+/=\r\n]+$/.test(value) && !/\s{2,}/.test(value);

const inferMediaFromBody = (body?: string): MessageMedia | null => {
  if (!body) return null;

  if (body.startsWith('data:')) {
    const match = body.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return { mimetype: match[1], data: match[2] };
  }

  if (!looksLikeBase64Payload(body)) {
    return null;
  }

  const trimmed = body.replace(/\s+/g, '');
  if (trimmed.startsWith('/9j/')) {
    return { mimetype: 'image/jpeg', data: trimmed, filename: 'image.jpg' };
  }
  if (trimmed.startsWith('iVBOR')) {
    return { mimetype: 'image/png', data: trimmed, filename: 'image.png' };
  }
  if (trimmed.startsWith('R0lGOD')) {
    return { mimetype: 'image/gif', data: trimmed, filename: 'image.gif' };
  }
  if (trimmed.startsWith('UklGR')) {
    return { mimetype: 'image/webp', data: trimmed, filename: 'image.webp' };
  }
  if (trimmed.startsWith('JVBERi0')) {
    return { mimetype: 'application/pdf', data: trimmed, filename: 'document.pdf' };
  }

  return { mimetype: 'application/octet-stream', data: trimmed, filename: 'attachment.bin' };
};

const CHAT_HISTORY_LIMIT = 300;
const CHAT_STATUS_STORAGE_KEY = 'openwa_chat_statuses_v1';

const normalizeContactNumber = (value?: string | null) => (value || '').replace(/[^0-9+]/g, '').trim();

const getDirectPhoneCandidate = (chat: Chat | null) =>
  chat && !chat.isGroup ? normalizeContactNumber(chat.id.split('@')[0]) : '';

const loadStoredChatStatuses = (): Record<string, 'open' | 'closed'> => {
  try {
    const raw = localStorage.getItem(CHAT_STATUS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, 'open' | 'closed'>;
  } catch {
    return {};
  }
};

const sortMessagesAscending = (items: ChatMessageView[]) =>
  [...items].sort((a, b) => {
    const aTime = a.timestamp || Math.floor(new Date(a.createdAt).getTime() / 1000);
    const bTime = b.timestamp || Math.floor(new Date(b.createdAt).getTime() / 1000);
    return aTime - bTime;
  });

const mapLiveHistoryMessage = (message: LiveChatHistoryMessage): ChatMessageView => ({
  id: message.id,
  waMessageId: message.id,
  chatId: message.chatId,
  from: message.from,
  to: message.to,
  body: message.body,
  type: asMessageType(message.type),
  direction: message.fromMe ? 'outgoing' : 'incoming',
  status: message.fromMe ? 'sent' : 'read',
  timestamp: message.timestamp,
  createdAt: new Date(message.timestamp * 1000).toISOString(),
  metadata: {
    media: message.media,
    quotedMessage: message.quotedMessage,
  },
});

const mergeMessageSources = (liveMessages: ChatMessageView[], storedMessages: ChatMessageView[]) => {
  const merged = new Map<string, ChatMessageView>();

  for (const message of liveMessages) {
    merged.set(message.waMessageId || message.id, message);
  }

  for (const message of storedMessages) {
    const key = message.waMessageId || message.id;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, message);
      continue;
    }

    merged.set(key, {
      ...existing,
      ...message,
      status: mergeDeliveryStatus(existing.status, message.status) ?? message.status,
      metadata: {
        ...existing.metadata,
        ...message.metadata,
      },
    });
  }

  return sortMessagesAscending(Array.from(merged.values()));
};

export function Chats() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.chats'));
  const { canWrite } = useRole();
  const { error: showErrorToast, warning: showWarningToast } = useToast();

  // Sessions list & active session
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionStatusById, setSessionStatusById] = useState<Record<string, string>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [showChannelMenu, setShowChannelMenu] = useState<boolean>(false);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);
  const [savedContacts, setSavedContacts] = useState<SavedContactRecord[]>([]);
  const [chatLifecycleByKey, setChatLifecycleByKey] = useState<Record<string, 'open' | 'closed'>>(loadStoredChatStatuses);

  // Chats list
  const [chats, setChats] = useState<InboxChat[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inboxView, setInboxView] = useState<'all' | 'unread' | 'direct' | 'groups'>('all');
  const [chatStateFilter, setChatStateFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [showChatStateMenu, setShowChatStateMenu] = useState<boolean>(false);
  const [sortMode, setSortMode] = useState<'recent' | 'oldest'>('recent');

  // Selected chat & message history
  const [activeChat, setActiveChat] = useState<InboxChat | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [messageInput, setMessageInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  // File attachments
  const [attachment, setAttachment] = useState<{
    file: File;
    base64: string;
    mimetype: string;
    filename: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  const [showChatInfo, setShowChatInfo] = useState<boolean>(false);
  const [contactPhone, setContactPhone] = useState<string>('');
  const [loadingContactPhone, setLoadingContactPhone] = useState<boolean>(false);
  const [contactEmailInput, setContactEmailInput] = useState<string>('');
  const [savingContactInfo, setSavingContactInfo] = useState<boolean>(false);
  const [availableLabels, setAvailableLabels] = useState<ChatLabel[]>([]);
  const [chatLabels, setChatLabels] = useState<ChatLabel[]>([]);
  const [labelsAvailable, setLabelsAvailable] = useState<boolean>(true);
  const [selectedLabelToAdd, setSelectedLabelToAdd] = useState<string>('');
  const activeSessionId = activeChat?.sessionId || selectedSessionId;
  const selectedChannels = sessions.filter(session => selectedChannelIds.includes(session.id));

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
        setSessionStatusById(
          readySessions.reduce<Record<string, string>>((acc, session) => {
            acc[session.id] = session.status;
            return acc;
          }, {}),
        );
        if (readySessions.length > 0) {
          setSelectedSessionId(readySessions[0].id);
          setSelectedChannelIds(readySessions.map(session => session.id));
        }
      } catch (err) {
        showErrorToast(t('chats.errors.loadSessions'), err instanceof Error ? err.message : undefined);
      } finally {
        setLoadingSessions(false);
      }
    };
    void loadSessions();
  }, [t, showErrorToast]);

  // 2. Fetch chats when active session changes
  const loadChats = useCallback(
    async (sessionIds: string[]) => {
      if (sessionIds.length === 0) {
        setChats([]);
        return;
      }
      try {
        setLoadingChats(true);
        const results = await Promise.allSettled(sessionIds.map(sessionId => sessionApi.getChats(sessionId)));
        const aggregated = results.flatMap((result, index) => {
          if (result.status !== 'fulfilled') {
            return [];
          }

          const session = sessions.find(item => item.id === sessionIds[index]);
          return result.value.map(
            chat =>
              ({
                ...chat,
                sessionId: sessionIds[index],
                sessionName: session?.name || sessionIds[index],
                sessionPhone: session?.phone,
              }) satisfies InboxChat,
          );
        });

        const sorted = [...aggregated].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setChats(sorted);
      } catch (err) {
        showErrorToast(t('chats.errors.loadChats'), err instanceof Error ? err.message : undefined);
        setChats([]);
      } finally {
        setLoadingChats(false);
      }
    },
    [sessions, t, showErrorToast],
  );

  useEffect(() => {
    if (selectedChannelIds.length > 0) {
      if (!selectedSessionId || !selectedChannelIds.includes(selectedSessionId)) {
        setSelectedSessionId(selectedChannelIds[0]);
      }
      void loadChats(selectedChannelIds);
      setActiveChat(null);
      setMessages([]);
      setAttachment(null);
      setPreviewUrl(null);
    } else {
      setChats([]);
      setActiveChat(null);
      setMessages([]);
    }
  }, [selectedChannelIds, selectedSessionId, loadChats]);

  useEffect(() => {
    if (!activeSessionId) {
      setSavedContacts([]);
      return;
    }

    let cancelled = false;
    contactApi
      .listSaved(activeSessionId)
      .then(result => {
        if (!cancelled) {
          setSavedContacts(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSavedContacts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(CHAT_STATUS_STORAGE_KEY, JSON.stringify(chatLifecycleByKey));
  }, [chatLifecycleByKey]);

  useEffect(() => {
    if (!activeSessionId) {
      setAvailableLabels([]);
      setLabelsAvailable(true);
      return;
    }

    labelApi
      .list(activeSessionId)
      .then(result => {
        setAvailableLabels(result);
        setLabelsAvailable(true);
      })
      .catch(() => {
        setAvailableLabels([]);
        setLabelsAvailable(false);
      });
  }, [activeSessionId]);

  const markChatRead = useCallback(
    (sessionId: string, chatId: string) => {
      const currentStatus = sessionStatusById[sessionId];
      if (!sessionId || currentStatus && currentStatus !== 'ready') {
        return;
      }
      void sessionApi.markChatRead(sessionId, chatId).catch(err => {
        showWarningToast(t('chats.errors.markRead'), err instanceof Error ? err.message : undefined);
      });
    },
    [sessionStatusById, t, showWarningToast],
  );

  // 3. WebSocket integration for real-time messages
  const handleIncomingMessage = useCallback(
    (event: { sessionId: string; message: Record<string, unknown> }) => {
      if (!selectedChannelIds.includes(event.sessionId)) return;

      const newMsg = event.message as unknown as IncomingWsMessage;

      // Update message list if the message belongs to the currently active chat
      if (activeChat && event.sessionId === activeChat.sessionId && newMsg.chatId === activeChat.id) {
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

      // Update sidebar chat list
      setChats(prevChats => {
        const chatIndex = prevChats.findIndex(c => c.sessionId === event.sessionId && c.id === newMsg.chatId);
        if (chatIndex === -1) {
          void loadChats(selectedChannelIds);
          return prevChats;
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
    [selectedChannelIds, activeChat, loadChats, markChatRead],
  );

  const handleIncomingMessageAck = useCallback(
    (event: { sessionId: string; messageId: string; status: ChatMessageView['status'] }) => {
      if (event.sessionId !== activeSessionId) return;

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
    [activeSessionId],
  );

  const handleIncomingMessageReaction = useCallback(
    (event: { sessionId: string; messageId: string; reactions: Record<string, string> }) => {
      if (event.sessionId !== activeSessionId) return;

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
    [activeSessionId],
  );

  const handleIncomingMessageRevoked = useCallback(
    (event: { sessionId: string; id: string; type: string }) => {
      if (event.sessionId !== activeSessionId) return;

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
    [activeSessionId],
  );

  const handleSessionStatus = useCallback((event: { sessionId: string; status: string }) => {
    setSessionStatusById(current => ({
      ...current,
      [event.sessionId]: event.status,
    }));
  }, []);

  const { isConnected, connectionFailed, reconnect, subscribe, unsubscribe } = useWebSocket({
    onSessionStatus: handleSessionStatus,
    onMessage: handleIncomingMessage,
    onMessageAck: handleIncomingMessageAck,
    onMessageReaction: handleIncomingMessageReaction,
    onMessageRevoked: handleIncomingMessageRevoked,
  });

  useEffect(() => {
    if (selectedChannelIds.length > 0 && isConnected) {
      for (const sessionId of selectedChannelIds) {
        subscribe(sessionId, [
          'session.status',
          'message.received',
          'message.sent',
          'message.ack',
          'message.reaction',
          'message.revoked',
        ]);
      }
      return () => {
        for (const sessionId of selectedChannelIds) {
          unsubscribe(sessionId);
        }
      };
    }
  }, [selectedChannelIds, isConnected, subscribe, unsubscribe]);

  // 4. Fetch message history for the selected chat
  const loadMessages = useCallback(
    async (sessionId: string, chatId: string) => {
      if (!sessionId || !chatId) return;
      try {
        setLoadingMessages(true);
        markChatRead(sessionId, chatId);
        const [storedResult, liveResult] = await Promise.allSettled([
          sessionApi.getChatMessages(sessionId, chatId, CHAT_HISTORY_LIMIT),
          sessionApi.getChatHistory(sessionId, chatId, CHAT_HISTORY_LIMIT, false),
        ]);

        const storedMessages =
          storedResult.status === 'fulfilled' ? sortMessagesAscending(storedResult.value.messages) : [];

        const liveMessages =
          liveResult.status === 'fulfilled' ? liveResult.value.map(mapLiveHistoryMessage) : [];

        if (liveMessages.length > 0) {
          setMessages(mergeMessageSources(liveMessages, storedMessages));
          return;
        }

        setMessages(storedMessages);
      } catch (err) {
        showErrorToast(t('chats.errors.loadMessages'), err instanceof Error ? err.message : undefined);
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [markChatRead, t, showErrorToast],
  );

  const handleReactMessage = async (msg: ChatMessageView, emoji: string) => {
    if (!activeSessionId || !activeChat) return;

    const msgId = msg.waMessageId || msg.id;
    const currentReactions = msg.metadata?.reactions || {};
    const sessionPhone = sessions.find(s => s.id === activeSessionId)?.phone || 'me';

    let alreadyReacted = false;
    for (const [sender, emo] of Object.entries(currentReactions)) {
      if ((sender === 'me' || sender.includes(sessionPhone)) && emo === emoji) {
        alreadyReacted = true;
        break;
      }
    }

    const emojiToSend = alreadyReacted ? '' : emoji;

    try {
      await messageApi.react(activeSessionId, {
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
    if (!activeSessionId || !activeChat) return;
    const msgId = msg.waMessageId || msg.id;

    if (!window.confirm(t('chats.deleteConfirm'))) return;

    try {
      await messageApi.delete(activeSessionId, {
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
        prev.map(c => (c.id === activeChat.id && c.sessionId === activeChat.sessionId ? { ...c, unreadCount: 0 } : c)),
      );
    } else {
      setMessages([]);
    }
  }, [activeChat, loadMessages]);

  // 5. Scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleSaveChatInfo = async () => {
    if (!activeSessionId || !activeChat || activeChat.isGroup) return;

    const number = normalizeContactNumber(contactPhone || directPhoneCandidate);
    if (!number) return;

    setSavingContactInfo(true);
    try {
      const next = await contactApi.saveBulk(activeSessionId, [
        {
          name: activeChat.name || undefined,
          number,
          email: contactEmailInput.trim() || undefined,
          source: 'session',
        },
      ]);
      setSavedContacts(next);
    } catch (err) {
      showWarningToast('Failed to save contact info', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingContactInfo(false);
    }
  };

  const handleToggleChatLifecycle = (chatId: string) => {
    const key = getChatWorkflowKey(activeChat?.sessionId || activeSessionId || '', chatId);
    setChatLifecycleByKey(current => ({
      ...current,
      [key]: current[key] === 'closed' ? 'open' : 'closed',
    }));
  };

  const handleAddChatLabel = async () => {
    if (!activeSessionId || !activeChat || !selectedLabelToAdd) return;
    try {
      await labelApi.addToChat(activeSessionId, activeChat.id, selectedLabelToAdd);
      const added = availableLabels.find(label => label.id === selectedLabelToAdd);
      if (added && !chatLabels.some(label => label.id === added.id)) {
        setChatLabels(current => [...current, added]);
      }
      setSelectedLabelToAdd('');
    } catch (err) {
      showWarningToast('Failed to add tag', err instanceof Error ? err.message : undefined);
    }
  };

  const handleRemoveChatLabel = async (labelId: string) => {
    if (!activeSessionId || !activeChat) return;
    try {
      await labelApi.removeFromChat(activeSessionId, activeChat.id, labelId);
      setChatLabels(current => current.filter(label => label.id !== labelId));
    } catch (err) {
      showWarningToast('Failed to remove tag', err instanceof Error ? err.message : undefined);
    }
  };

  // 7. Handle sending a message / media
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeSessionId || !activeChat || sending) return;

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

        result = await messageApi.sendMedia(activeSessionId, activeChat.id, mediaType, {
          base64: currentAttachment.base64,
          mimetype: currentAttachment.mimetype,
          filename: currentAttachment.filename,
          caption: mediaType !== 'audio' ? textToSend : undefined,
        });
      } else if (currentReplyingTo) {
        result = await messageApi.reply(activeSessionId, {
          chatId: activeChat.id,
          quotedMessageId: currentReplyingTo.waMessageId || currentReplyingTo.id,
          text: textToSend,
        });
      } else {
        result = await messageApi.sendText(activeSessionId, activeChat.id, textToSend);
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
        const chatIndex = prevChats.findIndex(c => c.id === activeChat.id && c.sessionId === activeChat.sessionId);
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
  const getChatWorkflowKey = useCallback(
    (sessionId: string, chatId: string) => `${sessionId}:${chatId}`,
    [],
  );
  const getChatLifecycle = useCallback(
    (sessionId: string, chatId: string) => chatLifecycleByKey[getChatWorkflowKey(sessionId, chatId)] || 'open',
    [chatLifecycleByKey, getChatWorkflowKey],
  );
  const directPhoneCandidate = getDirectPhoneCandidate(activeChat);
  const matchingSavedContact =
    activeChat && !activeChat.isGroup
      ? savedContacts.find(contact => normalizeContactNumber(contact.number) === normalizeContactNumber(contactPhone || directPhoneCandidate))
      : null;
  const totalUnread = chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
  const directChats = chats.filter(chat => !chat.isGroup).length;
  const groupChats = chats.filter(chat => chat.isGroup).length;
  const openChatsCount = chats.filter(chat => getChatLifecycle(chat.sessionId, chat.id) === 'open').length;
  const closedChatsCount = chats.filter(chat => getChatLifecycle(chat.sessionId, chat.id) === 'closed').length;
  const onlineSessionsCount = selectedChannels.filter(
    session => sessionStatusById[session.id] === 'ready' || session.status === 'ready',
  ).length;
  const activeChatMessageCount = messages.length;
  const activeChatUnread = activeChat?.unreadCount || 0;
  const activeChatLifecycle = activeChat ? getChatLifecycle(activeChat.sessionId, activeChat.id) : 'open';
  const selectedChannelSummary =
    selectedChannelIds.length === sessions.length
      ? 'All channels'
      : selectedChannels.length === 1
        ? selectedChannels[0].name
        : selectedChannels.map(session => session.name).join(', ');
  const channelMenuTitle = `All channels ${sessions.length}`;
  const infoPanelPhone =
    activeChat?.isGroup ? 'Not available for groups' : loadingContactPhone ? 'Resolving...' : contactPhone || 'Not available';
  const infoPanelEmail = matchingSavedContact?.email || '';

  const toggleChannelSelection = (sessionId: string) => {
    setSelectedChannelIds(current => {
      const checked = current.includes(sessionId);
      const next = checked ? current.filter(id => id !== sessionId) : [...current, sessionId];
      return next.length > 0 ? next : current;
    });
  };

  useEffect(() => {
    if (!activeChat || activeChat.isGroup) {
      setContactPhone('');
      setContactEmailInput('');
      setLoadingContactPhone(false);
      return;
    }

    const fallbackPhone = getDirectPhoneCandidate(activeChat);
    setContactPhone(fallbackPhone);
    setLoadingContactPhone(true);

    contactApi
      .resolvePhone(activeChat.sessionId, activeChat.id)
      .then(result => {
        setContactPhone(normalizeContactNumber(result.phone) || fallbackPhone);
      })
      .catch(() => {
        setContactPhone(fallbackPhone);
      })
      .finally(() => {
        setLoadingContactPhone(false);
      });
  }, [activeChat]);

  useEffect(() => {
    setContactEmailInput(matchingSavedContact?.email || '');
  }, [matchingSavedContact?.email]);

  useEffect(() => {
    if (!activeChat || !labelsAvailable) {
      setChatLabels([]);
      setSelectedLabelToAdd('');
      return;
    }

    labelApi
      .listForChat(activeChat.sessionId, activeChat.id)
      .then(result => {
        setChatLabels(result);
        setSelectedLabelToAdd('');
      })
      .catch(() => {
        setChatLabels([]);
      });
  }, [activeChat, labelsAvailable]);

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
        chat.sessionName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.id.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;
      if (inboxView === 'unread' && (chat.unreadCount || 0) <= 0) return false;
      if (inboxView === 'direct' && chat.isGroup) return false;
      if (inboxView === 'groups' && !chat.isGroup) return false;
      if (chatStateFilter === 'open' && getChatLifecycle(chat.sessionId, chat.id) !== 'open') return false;
      if (chatStateFilter === 'closed' && getChatLifecycle(chat.sessionId, chat.id) !== 'closed') return false;
      return true;
    })
    .sort((a, b) => {
      const aTime = a.timestamp || 0;
      const bTime = b.timestamp || 0;
      return sortMode === 'recent' ? bTime - aTime : aTime - bTime;
    });

  const inboxTitle =
    inboxView === 'unread'
      ? 'Unread queue'
      : inboxView === 'direct'
        ? 'Direct conversations'
        : inboxView === 'groups'
          ? 'Group conversations'
          : selectedChannelIds.length === sessions.length
            ? 'All channels'
            : selectedChannels.length === 1
              ? selectedChannels[0].name
              : `${selectedChannels.length} channels`;

  const inboxSubtitle =
    inboxView === 'unread'
      ? `${totalUnread} unread messages waiting for action`
      : `${filteredChats.length} conversations available in this workspace`;

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
          <aside className="chats-rail">
            <div className="chats-rail-brand">
              <div className="chats-rail-brand-icon">
                <MessageSquare size={18} />
              </div>
              <div>
                <div className="chats-rail-brand-title">Help Desk</div>
                <div className="chats-rail-brand-subtitle">WhatsApp operator workspace</div>
              </div>
            </div>

            <div className="chats-rail-group">
              <div className="chats-rail-label">Connected channels</div>
              <div className="chats-rail-card">
                <div className="chats-rail-card-top">
                  <div>
                    <div className="chats-rail-card-title">
                      {selectedChannelIds.length === sessions.length ? 'All WhatsApp channels' : `${selectedChannels.length} selected`}
                    </div>
                    <div className="chats-rail-card-subtitle">
                      {selectedChannels.map(session => session.name).join(', ') || 'Choose one or more connected sessions'}
                    </div>
                  </div>
                  <span className={`chats-session-badge ${isConnected ? 'online' : 'syncing'}`}>
                    <Wifi size={12} />
                    {isConnected ? 'Live' : 'Syncing'}
                  </span>
                </div>
                <div className="session-selector session-selector-static">
                  {selectedChannels.length} / {sessions.length} connected WhatsApp accounts included
                </div>
              </div>
            </div>

            <div className="chats-rail-group">
              <div className="chats-rail-label">Views</div>
              <div className="chats-rail-nav">
                <button
                  type="button"
                  className={`chats-rail-nav-item ${inboxView === 'all' ? 'active' : ''}`}
                  onClick={() => setInboxView('all')}
                >
                  <span className="chats-rail-nav-main">
                    <MessageSquare size={18} />
                    All
                  </span>
                  <span>{filteredChats.length}</span>
                </button>
                <button
                  type="button"
                  className={`chats-rail-nav-item ${inboxView === 'unread' ? 'active' : ''}`}
                  onClick={() => setInboxView('unread')}
                >
                  <span className="chats-rail-nav-main">
                    <Clock3 size={18} />
                    Unread
                  </span>
                  <span>{totalUnread}</span>
                </button>
                <button
                  type="button"
                  className={`chats-rail-nav-item ${inboxView === 'direct' ? 'active' : ''}`}
                  onClick={() => setInboxView('direct')}
                >
                  <span className="chats-rail-nav-main">
                    <Phone size={18} />
                    Direct
                  </span>
                  <span>{directChats}</span>
                </button>
                <button
                  type="button"
                  className={`chats-rail-nav-item ${inboxView === 'groups' ? 'active' : ''}`}
                  onClick={() => setInboxView('groups')}
                >
                  <span className="chats-rail-nav-main">
                    <Users size={18} />
                    Groups
                  </span>
                  <span>{groupChats}</span>
                </button>
              </div>
            </div>

            <div className="chats-rail-group chats-rail-group--summary">
              <div className="chats-rail-label">Live stats</div>
              <div className="chats-rail-stats">
                <div className="chats-rail-stat">
                  <span>Online</span>
                  <strong>{onlineSessionsCount}</strong>
                </div>
                <div className="chats-rail-stat">
                  <span>Unread</span>
                  <strong>{totalUnread}</strong>
                </div>
                <div className="chats-rail-stat">
                  <span>Direct</span>
                  <strong>{directChats}</strong>
                </div>
                <div className="chats-rail-stat">
                  <span>Groups</span>
                  <strong>{groupChats}</strong>
                </div>
              </div>
            </div>
          </aside>

          <section className="chats-inbox">
            <div className="chats-inbox-header">
              <div>
                <div className="chats-inbox-title">{inboxTitle}</div>
                <div className="chats-inbox-subtitle">{inboxSubtitle}</div>
              </div>
            </div>

            <div className="chats-inbox-toolbar">
              {/* Channel selector fix: compact trigger, full dark dropdown on demand. */}
              <div className="chats-toolbar-menu-wrap">
                <button
                  type="button"
                  className={`chats-toolbar-chip ${selectedChannelIds.length !== sessions.length ? 'active' : ''}`}
                  onClick={() => setShowChannelMenu(current => !current)}
                >
                  <span className="chats-toolbar-chip-label" title={selectedChannelSummary}>
                    {selectedChannelSummary}
                  </span>
                  <ChevronDown size={15} />
                </button>
                {showChannelMenu && (
                  <div className="chats-toolbar-menu chats-toolbar-menu--channels">
                    <div className="channel-menu-header">
                      <strong>{channelMenuTitle}</strong>
                      <span>{selectedChannelIds.length} selected</span>
                    </div>
                    <button
                      type="button"
                      className="channel-menu-all"
                      onClick={() => {
                        setSelectedChannelIds(sessions.map(session => session.id));
                        setShowChannelMenu(false);
                      }}
                    >
                      <span>All channels</span>
                      {selectedChannelIds.length === sessions.length ? <Check size={15} /> : <span>{sessions.length}</span>}
                    </button>
                    {sessions.map(session => {
                      const checked = selectedChannelIds.includes(session.id);
                      return (
                        <button
                          key={session.id}
                          type="button"
                          className={`channel-menu-option ${checked ? 'selected' : ''}`}
                          onClick={() => toggleChannelSelection(session.id)}
                        >
                          <div>
                            <strong>{session.name}</strong>
                            <span>{session.phone || t('chats.noPhone')}</span>
                          </div>
                          <span className="channel-menu-check">{checked ? <Check size={15} /> : null}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="chat-search-input">
                <Search size={18} />
                <input
                  type="text"
                  placeholder={t('chats.searchPlaceholder')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="chats-toolbar-menu-wrap">
                <button
                  type="button"
                  className={`chats-toolbar-chip ${chatStateFilter !== 'all' ? 'active' : ''}`}
                  onClick={() => setShowChatStateMenu(current => !current)}
                >
                  {chatStateFilter === 'all' ? 'All' : chatStateFilter === 'open' ? 'Open' : 'Closed'}
                  <ChevronDown size={15} />
                </button>
                {showChatStateMenu && (
                  <div className="chats-toolbar-menu">
                    <button type="button" onClick={() => { setChatStateFilter('all'); setShowChatStateMenu(false); }}>
                      All
                      <span>{chats.length}</span>
                    </button>
                    <button type="button" onClick={() => { setChatStateFilter('open'); setShowChatStateMenu(false); }}>
                      Open
                      <span>{openChatsCount}</span>
                    </button>
                    <button type="button" onClick={() => { setChatStateFilter('closed'); setShowChatStateMenu(false); }}>
                      Closed
                      <span>{closedChatsCount}</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="chats-toolbar-chip"
                onClick={() => setSortMode(current => (current === 'recent' ? 'oldest' : 'recent'))}
              >
                <ArrowUpDown size={15} />
                {sortMode === 'recent' ? 'Recent first' : 'Started first'}
              </button>
            </div>

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
                  const isActive = activeChat?.id === chat.id && activeChat?.sessionId === chat.sessionId;
                  return (
                    <div
                      key={`${chat.sessionId}:${chat.id}`}
                      className={`chat-item-card ${isActive ? 'active' : ''}`}
                      onClick={() => setActiveChat(chat)}
                    >
                      <div className="chat-avatar">
                        {chat.isGroup ? <Users size={20} /> : <User size={20} />}
                      </div>

                      <div className="chat-item-info">
                        <div className="chat-item-top">
                          <div className="chat-item-heading">
                            <span className="chat-item-name" title={chat.name || chat.id}>
                              {chat.name || chat.id.split('@')[0]}
                            </span>
                            <span className="chat-session-name">{chat.sessionName}</span>
                          </div>
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
                            <span className={`chat-state-badge ${getChatLifecycle(chat.sessionId, chat.id)}`}>
                              {getChatLifecycle(chat.sessionId, chat.id) === 'closed' ? 'Closed' : 'Open'}
                            </span>
                            {chat.unreadCount > 0 && (
                              <span className="chat-unread-badge">{chat.unreadCount}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="chat-card-info-btn"
                        onClick={event => {
                          event.stopPropagation();
                          setActiveChat(chat);
                          setShowChatInfo(true);
                        }}
                        aria-label="Open chat info"
                        title="Open chat info"
                      >
                        <Info size={16} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <main className="chats-room">
            {activeChat ? (
              <div className="room-container">
                <header className="room-header">
                  <div className="room-header-main">
                    <div className="room-avatar">
                      {activeChat.isGroup ? <Users size={20} /> : <User size={20} />}
                    </div>
                    <div className="room-contact-info">
                      <h3>{activeChat.name || activeChat.id.split('@')[0]}</h3>
                      <div className="room-contact-meta">
                        <span>{activeChat.sessionName}</span>
                        <span>{activeChat.isGroup ? 'Shared workspace' : '1:1 conversation'}</span>
                        <span>{activeChatMessageCount} messages loaded</span>
                        <span>{activeChatUnread} unread</span>
                      </div>
                    </div>
                  </div>
                  <div className="room-header-actions">
                    <div className="room-header-pill">
                      <Wifi size={14} />
                      {isConnected ? 'Connected' : 'Waiting for sync'}
                    </div>
                    <div className="room-header-pill subtle">{activeChat.isGroup ? 'Group' : 'Direct'}</div>
                    <button
                      type="button"
                      className={`room-status-toggle ${activeChatLifecycle}`}
                      onClick={() => handleToggleChatLifecycle(activeChat.id)}
                    >
                      {activeChatLifecycle === 'closed' ? 'Closed' : 'Open'}
                    </button>
                    {/* Header action fix: keep the info button always visible and aligned. */}
                    <button
                      type="button"
                      className={`room-info-btn ${showChatInfo ? 'active' : ''}`}
                      onClick={() => setShowChatInfo(current => !current)}
                      aria-label="Toggle chat info"
                      title="Toggle chat info"
                    >
                      <Info size={16} />
                    </button>
                  </div>
                </header>

                <div className={`room-content ${showChatInfo ? 'with-info' : ''}`}>
                  <div className="room-thread">
                {/* Scroll fix: only the message history region grows and scrolls. */}
                <div className="room-messages">
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

                      const inferredMedia = !msg.metadata?.media ? inferMediaFromBody(msg.body) : null;
                      const mediaInfo = msg.metadata?.media || inferredMedia;
                      const isMediaMessage = msg.type !== 'text' || !!mediaInfo;

                      const renderMedia = () => {
                        if (msg.type === 'revoked') return null;
                        if (!mediaInfo) return null;
                        const mediaSrc = getMediaSrc(mediaInfo);
                        if (!mediaSrc) return null;

                        switch (msg.type) {
                          case 'image':
                          case 'sticker':
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
                          case 'audio':
                          case 'voice':
                            return (
                              <div className="message-media-audio">
                                <audio src={mediaSrc} controls className="chat-audio-media" />
                              </div>
                            );
                          case 'document':
                          default:
                            return (
                              <div className="message-media-document">
                                <a
                                  href={mediaSrc}
                                  download={mediaInfo.filename || 'document'}
                                  className="chat-document-media"
                                >
                                  📎 {mediaInfo.filename || t('chats.downloadDocument')}
                                </a>
                              </div>
                            );
                        }
                      };

                      const reactions = msg.metadata?.reactions || {};
                      const hasReactions = Object.keys(reactions).length > 0;
                      const isRevoked = msg.type === 'revoked';

                      return (
                        <div
                          key={msg.id}
                          className={`message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`}
                        >
                          <div className="message-bubble-container">
                            <div
                              className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} ${msg.status} ${
                                isMediaMessage ? 'media-type' : ''
                              } ${isRevoked ? 'revoked-type' : ''}`}
                            >
                              {/* Quoted message display */}
                              {msg.metadata?.quotedMessage && (
                                <div className="message-quote-box">
                                  <div className="quote-body">{msg.metadata.quotedMessage.body}</div>
                                </div>
                              )}

                              {renderMedia()}

                              {isRevoked ? (
                                <div className="message-text">{t('chats.messageDeleted')}</div>
                              ) : (
                                msg.body &&
                                !inferredMedia &&
                                (!mediaInfo || msg.body !== mediaInfo.filename) && (
                                  <div className="message-text">{msg.body}</div>
                                )
                              )}

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

                  {showChatInfo && (
                    <aside className="chat-info-panel">
                      <div className="chat-info-panel-header">
                        <div>
                          <h3>Chat info</h3>
                          <p>{activeChat.sessionName}</p>
                        </div>
                        <button
                          type="button"
                          className="chat-info-close-btn"
                          onClick={() => setShowChatInfo(false)}
                          aria-label="Close chat info"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="chat-info-panel-body">
                        {/* Info panel cleanup: grouped cards, clearer labels, compact stats. */}
                        <section className="chat-info-card">
                          <span className="chat-info-section-title">Overview</span>
                          <div className="chat-info-group">
                            <span className="chat-info-label">Chat name</span>
                            <div className="chat-info-value">{activeChat.name || activeChat.id.split('@')[0]}</div>
                          </div>
                          <div className="chat-info-group">
                            <span className="chat-info-label">Chat ID</span>
                            <code className="chat-info-value">{activeChat.id}</code>
                          </div>
                          <div className="chat-info-group">
                            <span className="chat-info-label">Phone number</span>
                            <div className="chat-info-value">{infoPanelPhone}</div>
                          </div>
                          <div className="chat-info-group">
                            <span className="chat-info-label">Email</span>
                            <input
                              type="email"
                              value={contactEmailInput}
                              onChange={event => setContactEmailInput(event.target.value)}
                              placeholder="name@example.com"
                              className="chat-info-input"
                              disabled={activeChat.isGroup || savingContactInfo}
                            />
                            <span className="chat-info-help">
                              {infoPanelEmail ? 'Email ready to update from this panel.' : 'Save email only from this chat info panel.'}
                            </span>
                          </div>
                        </section>

                        <section className="chat-info-card">
                          <span className="chat-info-section-title">Chat status</span>
                          <div className="chat-info-stats-grid">
                            <div className="chat-info-stat-card">
                              <span className="chat-info-label">Status</span>
                              <div className="chat-info-value">{activeChatLifecycle === 'closed' ? 'Closed' : 'Open'}</div>
                            </div>
                            <div className="chat-info-stat-card">
                              <span className="chat-info-label">Type</span>
                              <div className="chat-info-value">{activeChat.isGroup ? 'Group chat' : 'Direct chat'}</div>
                            </div>
                            <div className="chat-info-stat-card">
                              <span className="chat-info-label">Unread count</span>
                              <div className="chat-info-value">{activeChatUnread}</div>
                            </div>
                            <div className="chat-info-stat-card">
                              <span className="chat-info-label">Loaded history</span>
                              <div className="chat-info-value">{activeChatMessageCount}</div>
                            </div>
                          </div>
                        </section>

                        <section className="chat-info-card">
                          <div className="chat-info-row">
                            <span className="chat-info-section-title">Tags</span>
                            {labelsAvailable && availableLabels.length > 0 && (
                              <div className="chat-info-tag-add">
                                <select value={selectedLabelToAdd} onChange={event => setSelectedLabelToAdd(event.target.value)}>
                                  <option value="">Select</option>
                                  {availableLabels
                                    .filter(label => !chatLabels.some(chatLabel => chatLabel.id === label.id))
                                    .map(label => (
                                      <option key={label.id} value={label.id}>
                                        {label.name}
                                      </option>
                                    ))}
                                </select>
                                <button type="button" onClick={() => void handleAddChatLabel()} disabled={!selectedLabelToAdd}>
                                  Add
                                </button>
                              </div>
                            )}
                          </div>
                          {!labelsAvailable ? (
                            <span className="chat-info-help">Tags are available only when labels are supported by this session.</span>
                          ) : chatLabels.length === 0 ? (
                            <div className="chat-info-empty-state">No tags added yet.</div>
                          ) : (
                            <div className="chat-info-tags">
                              {chatLabels.map(label => (
                                <button
                                  key={label.id}
                                  type="button"
                                  className="chat-info-tag-chip"
                                  onClick={() => void handleRemoveChatLabel(label.id)}
                                  style={{ '--tag-color': label.hexColor || '#25d366' } as CSSProperties}
                                  title="Remove tag"
                                >
                                  {label.name}
                                  <X size={12} />
                                </button>
                              ))}
                            </div>
                          )}
                        </section>
                      </div>

                      <div className="chat-info-panel-footer">
                        <button
                          type="button"
                          className="chat-info-save-btn"
                          onClick={() => void handleSaveChatInfo()}
                          disabled={activeChat.isGroup || savingContactInfo || !contactPhone}
                        >
                          {savingContactInfo ? <Loader2 className="animate-spin" size={16} /> : 'Save email'}
                        </button>
                      </div>
                    </aside>
                  )}
                </div>
              </div>
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
