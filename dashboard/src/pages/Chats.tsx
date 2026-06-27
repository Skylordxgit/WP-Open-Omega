import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Search,
  Send,
  Loader2,
  ChevronDown,
  Check,
  Info,
  Download,
  FileText,
  Image as ImageIcon,
  Music4,
  Play,
  Mic,
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

type MessageMedia = {
  mimetype: string;
  filename?: string;
  data?: string;
  url?: string;
  mediaUrl?: string;
  fileUrl?: string;
  previewUrl?: string;
  size?: number;
  filesize?: number;
  caption?: string;
};

type ResolvedMediaAttachment = {
  kind: 'image' | 'video' | 'audio' | 'document';
  src: string;
  filename: string;
  mimetype: string;
  size?: number;
  caption?: string;
};

type MessageContactInfo = {
  name?: string;
  pushName?: string;
  phone?: string;
  number?: string;
};

interface ChatMessageView extends ChatMessage {
  metadata?: {
    media?: MessageMedia;
    quotedMessage?: { id: string; body: string };
    reactions?: Record<string, string>;
    contact?: MessageContactInfo;
    senderPhone?: string | null;
  };
  text?: string;
  caption?: string;
  content?: string;
  mediaUrl?: string;
  fileUrl?: string;
  previewUrl?: string;
  url?: string;
  filename?: string;
  mimetype?: string;
  size?: number;
  filesize?: number;
  data?: string;
  t?: number;
  fromMe?: boolean;
  isMe?: boolean;
  quotedMessage?: { id?: string; body?: string; text?: string };
  quotedMsg?: { id?: string; body?: string; text?: string };
  mentions?: string[];
  mentionedJidList?: string[];
  contact?: MessageContactInfo;
  senderPhone?: string | null;
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
  text?: string;
  caption?: string;
  content?: string;
  mediaUrl?: string;
  fileUrl?: string;
  previewUrl?: string;
  url?: string;
  filename?: string;
  mimetype?: string;
  size?: number;
  filesize?: number;
  mentionedJidList?: string[];
  mentions?: string[];
  contact?: MessageContactInfo;
  senderPhone?: string | null;
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
  if (!media) return '';
  const directUrl = media.url || media.mediaUrl || media.fileUrl || media.previewUrl;
  if (directUrl) {
    return directUrl;
  }
  if (!media.data) return '';
  if (media.data.startsWith('data:') || media.data.startsWith('http://') || media.data.startsWith('https://')) {
    return media.data;
  }
  return `data:${media.mimetype};base64,${media.data}`;
};

const extensionMimeMap: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

const getMimeFromFilename = (filename?: string) => {
  if (!filename) return '';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return extensionMimeMap[ext] || '';
};

const normalizeMessageMedia = (message: ChatMessageView): MessageMedia | null => {
  const anyMessage = message as ChatMessageView & Record<string, unknown>;
  const metadataMedia = message.metadata?.media as MessageMedia | undefined;
  const inlineMedia = anyMessage.media as MessageMedia | undefined;

  const mediaUrl =
    (typeof anyMessage.mediaUrl === 'string' && anyMessage.mediaUrl) ||
    (typeof anyMessage.fileUrl === 'string' && anyMessage.fileUrl) ||
    (typeof anyMessage.deprecatedMms3Url === 'string' && anyMessage.deprecatedMms3Url) ||
    (typeof anyMessage.url === 'string' && anyMessage.url) ||
    (typeof anyMessage.previewUrl === 'string' && anyMessage.previewUrl) ||
    metadataMedia?.url ||
    metadataMedia?.mediaUrl ||
    metadataMedia?.fileUrl ||
    inlineMedia?.url ||
    inlineMedia?.mediaUrl ||
    inlineMedia?.fileUrl;

  const filename =
    (typeof anyMessage.filename === 'string' && anyMessage.filename) ||
    metadataMedia?.filename ||
    inlineMedia?.filename ||
    (typeof message.body === 'string' && /\.[a-z0-9]{2,6}$/i.test(message.body.trim()) ? message.body.trim() : undefined);

  const mimetype =
    (typeof anyMessage.mimetype === 'string' && anyMessage.mimetype) ||
    metadataMedia?.mimetype ||
    inlineMedia?.mimetype ||
    getMimeFromFilename(filename) ||
    '';

  const data =
    (typeof anyMessage.data === 'string' && anyMessage.data) ||
    metadataMedia?.data ||
    inlineMedia?.data;

  const size =
    (typeof anyMessage.size === 'number' && anyMessage.size) ||
    (typeof anyMessage.filesize === 'number' && anyMessage.filesize) ||
    metadataMedia?.size ||
    metadataMedia?.filesize ||
    inlineMedia?.size ||
    inlineMedia?.filesize;

  const caption =
    (typeof anyMessage.caption === 'string' && anyMessage.caption) ||
    metadataMedia?.caption ||
    inlineMedia?.caption;

  if (!mediaUrl && !data && !mimetype && !filename) {
    return null;
  }

  return {
    mimetype: mimetype || 'application/octet-stream',
    filename,
    data,
    url: mediaUrl || undefined,
    size,
    caption,
  };
};

const classifyMediaKind = (mimetype: string, type: MessageType, filename?: string): ResolvedMediaAttachment['kind'] => {
  if (type === 'image' || mimetype.startsWith('image/')) return 'image';
  if (type === 'video' || mimetype.startsWith('video/')) return 'video';
  if (type === 'audio' || type === 'voice' || mimetype.startsWith('audio/')) return 'audio';
  if (!mimetype && filename) {
    const guessedMime = getMimeFromFilename(filename);
    if (guessedMime.startsWith('image/')) return 'image';
    if (guessedMime.startsWith('video/')) return 'video';
    if (guessedMime.startsWith('audio/')) return 'audio';
  }
  return 'document';
};

const formatFileSize = (size?: number) => {
  if (!size || Number.isNaN(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const MENTION_PATTERN = /@(\d{6,})/g;

const getMessageTimestamp = (message: ChatMessageView) => {
  const anyMessage = message as ChatMessageView & Record<string, unknown>;
  const fromMessage = typeof message.timestamp === 'number' ? message.timestamp : undefined;
  const fromAltField = typeof anyMessage.t === 'number' ? anyMessage.t : undefined;
  const fromCreatedAt = Number.isFinite(new Date(message.createdAt).getTime())
    ? Math.floor(new Date(message.createdAt).getTime() / 1000)
    : 0;
  return fromMessage ?? fromAltField ?? fromCreatedAt;
};

const getMessageKey = (message: ChatMessageView) => {
  const anyMessage = message as ChatMessageView & Record<string, unknown>;
  const primary = message.waMessageId || message.id;
  if (primary) return primary;
  return [
    typeof anyMessage.chatId === 'string' ? anyMessage.chatId : '',
    typeof anyMessage.from === 'string' ? anyMessage.from : '',
    typeof anyMessage.to === 'string' ? anyMessage.to : '',
    getMessageTimestamp(message),
    typeof anyMessage.type === 'string' ? anyMessage.type : '',
    typeof anyMessage.body === 'string' ? anyMessage.body : '',
  ].join('::');
};

const getMessageText = (message: ChatMessageView): string => {
  const anyMessage = message as ChatMessageView & Record<string, unknown>;
  return (
    (typeof anyMessage.caption === 'string' && anyMessage.caption) ||
    (typeof anyMessage.text === 'string' && anyMessage.text) ||
    (typeof anyMessage.content === 'string' && anyMessage.content) ||
    message.body ||
    ''
  );
};

const getQuotedMessageBody = (message: ChatMessageView): string | null => {
  const anyMessage = message as ChatMessageView & Record<string, unknown>;
  const quoted =
    message.metadata?.quotedMessage ||
    (typeof anyMessage.quotedMessage === 'object' && anyMessage.quotedMessage
      ? (anyMessage.quotedMessage as { id?: string; body?: string })
      : null) ||
    (typeof anyMessage.quotedMsg === 'object' && anyMessage.quotedMsg
      ? (anyMessage.quotedMsg as { id?: string; body?: string; text?: string })
      : null);

  if (!quoted) return null;
  return quoted.body || ('text' in quoted && typeof quoted.text === 'string' ? quoted.text : '') || null;
};

const resolveAttachment = (message: ChatMessageView): ResolvedMediaAttachment | null => {
  const normalized = normalizeMessageMedia(message) || inferMediaFromBody(message.body);
  if (!normalized) return null;
  const src = getMediaSrc(normalized);

  return {
    kind: classifyMediaKind(normalized.mimetype, message.type, normalized.filename),
    src,
    filename: normalized.filename || 'attachment',
    mimetype: normalized.mimetype,
    size: normalized.size,
    caption: normalized.caption,
  };
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

const CHAT_HISTORY_LIMIT = 200;
const CHAT_HISTORY_INCREMENT = 200;
const CHAT_STATUS_STORAGE_KEY = 'openwa_chat_statuses_v1';

const normalizeContactNumber = (value?: string | null) => (value || '').replace(/[^0-9+]/g, '').trim();
const getChatIdUserPart = (value?: string | null) => (value || '').split('@')[0].split(':')[0];
const isLidChatId = (value?: string | null) => /@lid$/i.test(value || '');
const getChatPhoneKey = (sessionId: string, chatId: string) => `${sessionId}:${chatId}`;

const formatDisplayPhone = (value?: string | null) => {
  const normalized = normalizeContactNumber(value);
  if (!normalized) return '';
  const digits = normalized.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10 && !normalized.startsWith('+')) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.startsWith('44') && digits.length >= 11) {
    return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  if (digits.startsWith('65') && digits.length === 10) {
    return `+65 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return `+${digits}`;
};

const isRawWhatsAppIdentifier = (value?: string | null, chatId?: string | null) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return true;
  const userPart = getChatIdUserPart(chatId);
  return (
    trimmed === chatId ||
    trimmed === userPart ||
    /@(?:lid|c\.us|s\.whatsapp\.net|g\.us)$/i.test(trimmed) ||
    (isLidChatId(chatId) && /^\d{8,}$/.test(trimmed))
  );
};

const getLidFallbackLabel = (chatId: string) => {
  return isLidChatId(chatId) ? 'Resolving WhatsApp number...' : getChatIdUserPart(chatId);
};

const getDirectPhoneCandidate = (chat: Chat | null) =>
  chat && !chat.isGroup
    ? normalizeContactNumber(chat.phone || (isLidChatId(chat.id) ? '' : getChatIdUserPart(chat.id)))
    : '';

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
    const aTime = getMessageTimestamp(a);
    const bTime = getMessageTimestamp(b);
    return aTime - bTime;
  });

const mapLiveHistoryMessage = (message: LiveChatHistoryMessage): ChatMessageView => {
  const rawMessage = message as LiveChatHistoryMessage & Record<string, unknown>;
  const rawMetadata =
    typeof rawMessage.metadata === 'object' && rawMessage.metadata ? (rawMessage.metadata as ChatMessageView['metadata']) : {};
  const rawContact =
    typeof rawMessage.contact === 'object' && rawMessage.contact ? (rawMessage.contact as MessageContactInfo) : undefined;
  const rawSenderPhone = typeof rawMessage.senderPhone === 'string' ? rawMessage.senderPhone : undefined;
  return {
    ...(rawMessage as Partial<ChatMessageView>),
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
      ...rawMetadata,
      media: message.media,
      quotedMessage: message.quotedMessage,
      contact: rawContact || rawMetadata?.contact,
      senderPhone: rawSenderPhone || rawMetadata?.senderPhone,
    },
  };
};

const mergeMessageSources = (liveMessages: ChatMessageView[], storedMessages: ChatMessageView[]) => {
  const merged = new Map<string, ChatMessageView>();
  let duplicateCount = 0;

  for (const message of liveMessages) {
    merged.set(getMessageKey(message), message);
  }

  for (const message of storedMessages) {
    const key = getMessageKey(message);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, message);
      continue;
    }

    duplicateCount += 1;

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

  return {
    messages: sortMessagesAscending(Array.from(merged.values())),
    duplicateCount,
  };
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
  const [loadingOlderMessages, setLoadingOlderMessages] = useState<boolean>(false);
  const [messageLoadError, setMessageLoadError] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);
  const [messageHistoryLimit, setMessageHistoryLimit] = useState<number>(CHAT_HISTORY_LIMIT);
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
  const [activeMediaPreview, setActiveMediaPreview] = useState<ResolvedMediaAttachment | null>(null);
  const [chatPhoneByKey, setChatPhoneByKey] = useState<Record<string, string | null>>({});
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
  const messageLoadRequestRef = useRef(0);
  const skipNextAutoScrollRef = useRef(false);
  const resolvingChatPhonesRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessageView | null>(null);

  const isSessionReadyForMessages = useCallback((sessionId: string) => {
    const status = (sessionStatusById[sessionId] || '').toLowerCase();
    return !status || ['ready', 'connected', 'open'].includes(status);
  }, [sessionStatusById]);

  const contactNameByNumber = useCallback(
    (value: string) => {
      const normalized = normalizeContactNumber(value);
      if (!normalized) return null;

      const savedMatch = savedContacts.find(contact => normalizeContactNumber(contact.number) === normalized);
      if (savedMatch?.name) return savedMatch.name;

      const chatMatch = chats.find(
        chat => normalizeContactNumber(chat.phone || getChatIdUserPart(chat.id)) === normalized,
      );
      return chatMatch?.name || null;
    },
    [savedContacts, chats],
  );

  const renderMessageBody = useCallback(
    (text: string): ReactNode => {
      const renderPlainSegment = (segment: string, segmentKey: string) => {
        const parts: ReactNode[] = [];
        let cursor = 0;
        let matchIndex = 0;

        for (const match of segment.matchAll(MENTION_PATTERN)) {
          const fullMatch = match[0];
          const mentionDigits = match[1];
          const start = match.index ?? 0;

          if (start > cursor) {
            parts.push(<span key={`${segmentKey}-text-${matchIndex}`}>{segment.slice(cursor, start)}</span>);
          }

          const resolvedName = contactNameByNumber(mentionDigits);
          parts.push(
            <span key={`${segmentKey}-mention-${matchIndex}`} className="message-mention">
              @{resolvedName || mentionDigits}
            </span>,
          );

          cursor = start + fullMatch.length;
          matchIndex += 1;
        }

        if (cursor < segment.length) {
          parts.push(<span key={`${segmentKey}-tail`}>{segment.slice(cursor)}</span>);
        }

        return parts.length > 0 ? parts : [<span key={`${segmentKey}-full`}>{segment}</span>];
      };

      const linkedParts = text.split(URL_PATTERN);
      return linkedParts.map((part, index) => {
        if (!part) return null;
        const isUrl = URL_PATTERN.test(part);
        URL_PATTERN.lastIndex = 0;
        if (!isUrl) {
          return <span key={`body-${index}`}>{renderPlainSegment(part, `body-${index}`)}</span>;
        }

        const href = part.startsWith('http') ? part : `https://${part}`;
        return (
          <a key={`${href}-${index}`} href={href} target="_blank" rel="noreferrer" className="message-link">
            {part}
          </a>
        );
      });
    },
    [contactNameByNumber],
  );

  const getMessageFallbackLabel = useCallback((message: ChatMessageView) => {
    if (message.type === 'revoked') return t('chats.messageDeleted');
    if (message.type === 'sticker') return 'Sticker';
    if (message.type === 'location') return 'Location shared';
    if (message.type === 'contact') return 'Contact card';
    return 'Unsupported message type';
  }, [t]);

  const getRenderableMessageInfo = useCallback(
    (message: ChatMessageView) => {
      const attachment = resolveAttachment(message);
      const messageText = getMessageText(message).trim();
      const quotedMessageBody = getQuotedMessageBody(message);
      const hasText = Boolean(messageText);
      const hasQuote = Boolean(quotedMessageBody);
      const isRevoked = message.type === 'revoked';
      const isSupportedSystemMessage = ['sticker', 'location', 'contact'].includes(message.type);
      const hasRenderableContent = isRevoked || hasText || Boolean(attachment) || hasQuote || isSupportedSystemMessage;
      const shouldRenderFallback = !hasRenderableContent && message.type !== 'text';

      return {
        attachment,
        messageText,
        quotedMessageBody,
        shouldRender: hasRenderableContent,
        shouldRenderFallback,
        fallbackLabel: shouldRenderFallback ? getMessageFallbackLabel(message) : '',
      };
    },
    [getMessageFallbackLabel],
  );

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
    const candidates = chats
      .filter(chat => !chat.isGroup && isLidChatId(chat.id))
      .filter(chat => {
        const key = getChatPhoneKey(chat.sessionId, chat.id);
        return !(key in chatPhoneByKey) && !resolvingChatPhonesRef.current.has(key);
      })
      .slice(0, 25);

    if (candidates.length === 0) {
      return;
    }

    let cancelled = false;
    for (const chat of candidates) {
      resolvingChatPhonesRef.current.add(getChatPhoneKey(chat.sessionId, chat.id));
    }

    void Promise.all(
      candidates.map(async chat => {
        const key = getChatPhoneKey(chat.sessionId, chat.id);
        try {
          const result = await contactApi.resolvePhone(chat.sessionId, chat.id);
          return { key, phone: normalizeContactNumber(result.phone) || null };
        } catch {
          return { key, phone: null };
        }
      }),
    ).then(results => {
      if (!cancelled) {
        setChatPhoneByKey(current => {
          const next = { ...current };
          for (const result of results) {
            next[result.key] = result.phone;
          }
          return next;
        });
      }
      for (const result of results) {
        resolvingChatPhonesRef.current.delete(result.key);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [chatPhoneByKey, chats]);

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
      if (!sessionId || !isSessionReadyForMessages(sessionId)) {
        return;
      }
      void sessionApi.markChatRead(sessionId, chatId).catch(err => {
        showWarningToast(t('chats.errors.markRead'), err instanceof Error ? err.message : undefined);
      });
    },
    [isSessionReadyForMessages, t, showWarningToast],
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
          ...(newMsg as Partial<ChatMessageView>),
          id: newMsg.id,
          waMessageId: newMsg.id,
          chatId: newMsg.chatId,
          from: newMsg.from,
          to: newMsg.to,
          body: newMsg.body || newMsg.text || newMsg.caption || newMsg.content || '',
          type: asMessageType(newMsg.type),
          direction: newMsg.fromMe ? 'outgoing' : 'incoming',
          status: 'sent',
          timestamp: newMsg.timestamp,
          createdAt: new Date(newMsg.timestamp * 1000).toISOString(),
          metadata: {
            ...(newMsg.metadata || {}),
            media: newMsg.metadata?.media || newMsg.media,
            quotedMessage: newMsg.metadata?.quotedMessage || newMsg.quotedMessage,
            contact: newMsg.metadata?.contact || newMsg.contact,
            senderPhone: newMsg.metadata?.senderPhone || newMsg.senderPhone,
          },
        };

        const mappedInfo = getRenderableMessageInfo(mappedMessage);
        if (!mappedInfo.shouldRender && !mappedInfo.shouldRenderFallback) {
          console.debug('[Chats] skipped live message', {
            selectedChatId: activeChat.id,
            sessionId: activeChat.sessionId,
            messageId: mappedMessage.id,
            type: mappedMessage.type,
          });
          return;
        }

        setMessages(prev => {
          if (prev.some(m => getMessageKey(m) === getMessageKey(mappedMessage))) {
            return prev;
          }
          const nextMessage =
            mappedInfo.shouldRender
              ? mappedMessage
              : {
                  ...mappedMessage,
                  body: mappedInfo.fallbackLabel,
                  text: mappedInfo.fallbackLabel,
                  content: mappedInfo.fallbackLabel,
                  type: 'unknown' as const,
                };
          return sortMessagesAscending([...prev, nextMessage]);
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
    [selectedChannelIds, activeChat, getRenderableMessageInfo, loadChats, markChatRead],
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
    async (sessionId: string, chatId: string, limit = CHAT_HISTORY_LIMIT, options?: { preserveScroll?: boolean }) => {
      if (!sessionId || !chatId) return;
      const requestId = ++messageLoadRequestRef.current;
      const shouldPreserveScroll = options?.preserveScroll === true;
      if (shouldPreserveScroll) {
        skipNextAutoScrollRef.current = true;
        setLoadingOlderMessages(true);
      } else {
        setLoadingMessages(true);
      }
      setMessageLoadError(null);

      try {
        markChatRead(sessionId, chatId);
        const liveLimit = Math.min(limit, 100);
        const [storedResult, liveResult] = await Promise.allSettled([
          sessionApi.getChatMessages(sessionId, chatId, limit),
          sessionApi.getChatHistory(sessionId, chatId, liveLimit, true),
        ]);

        if (requestId !== messageLoadRequestRef.current) {
          return;
        }

        const storedMessages =
          storedResult.status === 'fulfilled' ? sortMessagesAscending(storedResult.value.messages) : [];

        const liveMessages =
          liveResult.status === 'fulfilled' ? liveResult.value.map(mapLiveHistoryMessage) : [];

        const mergedResult = mergeMessageSources(liveMessages, storedMessages);
        const normalizedMessages = mergedResult.messages
          .filter(message => {
            const info = getRenderableMessageInfo(message);
            return info.shouldRender || info.shouldRenderFallback;
          })
          .map(message => {
            const info = getRenderableMessageInfo(message);
            if (info.shouldRender) return message;
            return {
              ...message,
              body: info.fallbackLabel,
              text: info.fallbackLabel,
              content: info.fallbackLabel,
              type: 'unknown' as const,
            } satisfies ChatMessageView;
          });
        const skippedEmptyMessages = mergedResult.messages.length - normalizedMessages.length;
        const storedTotal = storedResult.status === 'fulfilled' ? storedResult.value.total : storedMessages.length;
        const maybeHasMore = storedTotal > normalizedMessages.length || storedMessages.length >= limit;

        console.debug('[Chats] message load', {
          selectedChatId: chatId,
          sessionId,
          requestedLimit: limit,
          storedFetched: storedMessages.length,
          storedTotal,
          liveFetched: liveMessages.length,
          totalMessagesFetched: storedMessages.length + liveMessages.length,
          totalMessagesRendered: normalizedMessages.length,
          duplicatesRemoved: mergedResult.duplicateCount,
          unsupportedOrEmptySkipped: skippedEmptyMessages,
          paginationCursor: `limit:${limit}`,
          hasMore: maybeHasMore,
        });

        setMessages(normalizedMessages);
        setHasMoreMessages(maybeHasMore);
      } catch (err) {
        if (requestId !== messageLoadRequestRef.current) {
          return;
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showErrorToast(t('chats.errors.loadMessages'), errorMessage);
        setMessageLoadError(errorMessage);
        setMessages([]);
        setHasMoreMessages(false);
      } finally {
        if (requestId === messageLoadRequestRef.current) {
          setLoadingMessages(false);
          setLoadingOlderMessages(false);
        }
      }
    },
    [getRenderableMessageInfo, markChatRead, t, showErrorToast],
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
      setMessageHistoryLimit(CHAT_HISTORY_LIMIT);
      setMessageLoadError(null);
      setHasMoreMessages(false);
      skipNextAutoScrollRef.current = false;
      void loadMessages(activeChat.sessionId, activeChat.id, CHAT_HISTORY_LIMIT);
      setChats(prev =>
        prev.map(c => (c.id === activeChat.id && c.sessionId === activeChat.sessionId ? { ...c, unreadCount: 0 } : c)),
      );
    } else {
      messageLoadRequestRef.current += 1;
      setMessages([]);
      setMessageLoadError(null);
      setHasMoreMessages(false);
    }
  }, [activeChat, loadMessages]);

  // 5. Scroll chat to bottom
  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!activeChat || !messageLoadError || !isSessionReadyForMessages(activeChat.sessionId)) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void loadMessages(activeChat.sessionId, activeChat.id, messageHistoryLimit);
    }, 1800);

    return () => window.clearTimeout(retryTimer);
  }, [activeChat, isSessionReadyForMessages, loadMessages, messageHistoryLimit, messageLoadError]);

  const handleLoadOlderMessages = useCallback(() => {
    if (!activeChat || loadingOlderMessages) return;
    const nextLimit = messageHistoryLimit + CHAT_HISTORY_INCREMENT;
    setMessageHistoryLimit(nextLimit);
    void loadMessages(activeChat.sessionId, activeChat.id, nextLimit, { preserveScroll: true });
  }, [activeChat, loadMessages, loadingOlderMessages, messageHistoryLimit]);

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

  const closeMediaPreview = () => setActiveMediaPreview(null);

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleSaveChatInfo = async () => {
    if (!activeSessionId || !activeChat || activeChat.isGroup) return;

    const number = normalizeContactNumber(contactPhone || directPhoneCandidate);
    if (!number) return;

    setSavingContactInfo(true);
    try {
      const next = await contactApi.saveBulk(activeSessionId, [
        {
          name: getChatDisplayName(activeChat, contactPhone || directPhoneCandidate) || undefined,
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
  const getMessageContactInfo = (message: ChatMessageView): MessageContactInfo | null => {
    const metadataContact = message.metadata?.contact;
    const directContact = message.contact;
    const senderPhone =
      message.senderPhone ||
      (typeof message.metadata?.senderPhone === 'string' ? message.metadata.senderPhone : undefined);
    return metadataContact || directContact || senderPhone ? { ...directContact, ...metadataContact, phone: senderPhone } : null;
  };
  const getActiveMessageContactInfo = (chat: InboxChat | null): MessageContactInfo | null => {
    if (!chat || activeChat?.id !== chat.id || activeChat?.sessionId !== chat.sessionId) return null;
    for (const message of messages) {
      const contact = getMessageContactInfo(message);
      if (contact?.name || contact?.pushName || contact?.phone || contact?.number) {
        return contact;
      }
    }
    return null;
  };
  const getSavedContactForChat = (chat: Chat, resolvedPhone?: string) => {
    const phone = normalizeContactNumber(
      resolvedPhone ||
        ('sessionId' in chat ? chatPhoneByKey[getChatPhoneKey((chat as InboxChat).sessionId, chat.id)] : '') ||
        chat.phone ||
        getDirectPhoneCandidate(chat),
    );
    return phone ? savedContacts.find(contact => normalizeContactNumber(contact.number) === phone) || null : null;
  };
  const getChatDisplayName = (chat: InboxChat | null, resolvedPhone?: string) => {
    if (!chat) return '';
    const resolvedListPhone = chatPhoneByKey[getChatPhoneKey(chat.sessionId, chat.id)];
    const savedContact = getSavedContactForChat(chat, resolvedPhone);
    const messageContact = getActiveMessageContactInfo(chat);
    const readableName =
      savedContact?.name ||
      (!isRawWhatsAppIdentifier(chat.name, chat.id) && chat.name) ||
      (!isRawWhatsAppIdentifier(chat.pushName, chat.id) && chat.pushName) ||
      (!isRawWhatsAppIdentifier(messageContact?.name, chat.id) && messageContact?.name) ||
      (!isRawWhatsAppIdentifier(messageContact?.pushName, chat.id) && messageContact?.pushName);
    if (readableName) return readableName;

    const phone = normalizeContactNumber(
      resolvedPhone || resolvedListPhone || chat.phone || messageContact?.phone || messageContact?.number,
    );
    if (phone) return formatDisplayPhone(phone);

    return isLidChatId(chat.id) ? getLidFallbackLabel(chat.id) : getChatIdUserPart(chat.id);
  };
  const getChatTitle = (chat: InboxChat | null, resolvedPhone?: string) => {
    if (!chat) return '';
    const displayName = getChatDisplayName(chat, resolvedPhone);
    if (isLidChatId(chat.id)) return displayName;
    return displayName === chat.id ? chat.id : `${displayName} (${chat.id})`;
  };
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
    activeChat && !activeChat.isGroup ? getSavedContactForChat(activeChat, contactPhone || directPhoneCandidate) : null;
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
  const activeChatResolvedPhone = activeChat ? chatPhoneByKey[getChatPhoneKey(activeChat.sessionId, activeChat.id)] : undefined;
  const selectedChannelSummary =
    selectedChannelIds.length === sessions.length
      ? 'All channels'
      : selectedChannels.length === 1
        ? selectedChannels[0].name
        : selectedChannels.map(session => session.name).join(', ');
  const channelMenuTitle = `All channels ${sessions.length}`;
  const infoPanelPhone =
    activeChat?.isGroup
      ? 'Not available for groups'
      : loadingContactPhone
        ? 'Resolving...'
        : contactPhone
          ? formatDisplayPhone(contactPhone)
          : 'Not available';
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

    const activeKey = getChatPhoneKey(activeChat.sessionId, activeChat.id);
    const fallbackPhone = normalizeContactNumber(activeChatResolvedPhone || getDirectPhoneCandidate(activeChat));
    setContactPhone(fallbackPhone);
    setLoadingContactPhone(true);

    contactApi
      .resolvePhone(activeChat.sessionId, activeChat.id)
      .then(result => {
        const resolvedPhone = normalizeContactNumber(result.phone) || fallbackPhone;
        setContactPhone(resolvedPhone);
        if (resolvedPhone) {
          setChatPhoneByKey(current =>
            current[activeKey] === resolvedPhone ? current : { ...current, [activeKey]: resolvedPhone },
          );
        }
      })
      .catch(() => {
        setContactPhone(fallbackPhone);
      })
      .finally(() => {
        setLoadingContactPhone(false);
      });
  }, [activeChat, activeChatResolvedPhone]);

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
      const displayName = getChatDisplayName(chat);
      const matchesSearch =
        displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.pushName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chat.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
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
                            <span className="chat-item-name" title={getChatTitle(chat)}>
                              {getChatDisplayName(chat)}
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
              <>
              <div className="room-container">
                <header className="room-header">
                  <div className="room-header-main">
                    <div className="room-avatar">
                      {activeChat.isGroup ? <Users size={20} /> : <User size={20} />}
                    </div>
                    <div className="room-contact-info">
                      <h3>{getChatDisplayName(activeChat, contactPhone || directPhoneCandidate)}</h3>
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
                      <span className="room-info-btn-glyph" aria-hidden="true">i</span>
                    </button>
                  </div>
                </header>

                <div className={`room-content ${showChatInfo ? 'with-info' : ''}`}>
                  <div className="room-thread">
                {/* Scroll fix: only the message history region grows and scrolls. */}
                <div className="room-messages">
                  {hasMoreMessages && (
                    <div className="messages-pagination-row">
                      <button
                        type="button"
                        className="messages-load-older-btn"
                        onClick={handleLoadOlderMessages}
                        disabled={loadingOlderMessages}
                      >
                        {loadingOlderMessages ? <Loader2 className="animate-spin" size={14} /> : null}
                        <span>{loadingOlderMessages ? 'Loading older messages...' : 'Load older messages'}</span>
                      </button>
                    </div>
                  )}
                  {messageLoadError && !loadingMessages && (
                    <div className="messages-inline-error" role="status">
                      <AlertCircle size={16} />
                      <span>{messageLoadError}</span>
                      <button
                        type="button"
                        className="messages-retry-btn"
                        onClick={() => activeChat && void loadMessages(activeChat.sessionId, activeChat.id, messageHistoryLimit)}
                      >
                        Retry
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
                      const anyMessage = msg as ChatMessageView & Record<string, unknown>;
                      const isMe = msg.direction === 'outgoing' || anyMessage.fromMe === true || anyMessage.isMe === true;
                      const formattedTime = formatTime(getMessageTimestamp(msg));
                      const renderInfo = getRenderableMessageInfo(msg);
                      const messageText = renderInfo.messageText;
                      const quotedMessageBody = renderInfo.quotedMessageBody;
                      const attachmentInfo = renderInfo.attachment;
                      const isMediaMessage = msg.type !== 'text' || !!attachmentInfo;

                      const renderMedia = () => {
                        if (msg.type === 'revoked') return null;
                        if (!attachmentInfo) return null;

                        switch (attachmentInfo.kind) {
                          case 'image':
                            return (
                              <button
                                type="button"
                                className="message-media-image"
                                onClick={() => attachmentInfo.src && setActiveMediaPreview(attachmentInfo)}
                              >
                                {attachmentInfo.src ? (
                                  <img
                                    src={attachmentInfo.src}
                                    alt={attachmentInfo.filename || 'WhatsApp image'}
                                    className="chat-image-media"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="chat-media-fallback">
                                    <ImageIcon size={22} />
                                    <span>Image preview unavailable</span>
                                  </div>
                                )}
                                <span className="media-filename">{attachmentInfo.filename}</span>
                              </button>
                            );
                          case 'video':
                            return (
                              <button
                                type="button"
                                className="message-media-video"
                                onClick={() => attachmentInfo.src && setActiveMediaPreview(attachmentInfo)}
                              >
                                {attachmentInfo.src ? (
                                  <video src={attachmentInfo.src} className="chat-video-media" preload="metadata" />
                                ) : (
                                  <div className="chat-media-fallback">
                                    <Play size={22} />
                                    <span>Video preview unavailable</span>
                                  </div>
                                )}
                                {attachmentInfo.src && (
                                  <span className="chat-video-overlay">
                                    <Play size={22} />
                                  </span>
                                )}
                                <span className="media-filename">{attachmentInfo.filename}</span>
                              </button>
                            );
                          case 'audio':
                            return (
                              <div className="message-media-audio">
                                <div className="chat-audio-card">
                                  <div className="chat-audio-card-head">
                                    <Music4 size={16} />
                                    <span>{attachmentInfo.filename}</span>
                                  </div>
                                  {attachmentInfo.src ? (
                                    <audio src={attachmentInfo.src} controls className="chat-audio-media" preload="metadata" />
                                  ) : (
                                    <div className="chat-media-fallback compact">
                                      <span>Audio preview unavailable</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          case 'document':
                          default:
                            return (
                              <div className="message-media-document">
                                <a
                                  href={attachmentInfo.src || '#'}
                                  download={attachmentInfo.filename || 'document'}
                                  className={`chat-document-media ${attachmentInfo.src ? '' : 'disabled'}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={event => {
                                    if (!attachmentInfo.src) {
                                      event.preventDefault();
                                    }
                                  }}
                                >
                                  <span className="chat-document-icon">
                                    {attachmentInfo.mimetype === 'application/pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
                                  </span>
                                  <span className="chat-document-copy">
                                    <strong>{attachmentInfo.filename || t('chats.downloadDocument')}</strong>
                                    <span>
                                      {[attachmentInfo.mimetype.split('/').pop()?.toUpperCase(), formatFileSize(attachmentInfo.size)]
                                        .filter(Boolean)
                                        .join(' - ') || 'Open attachment'}
                                    </span>
                                  </span>
                                  <span className="chat-document-action">
                                    <Download size={16} />
                                  </span>
                                </a>
                              </div>
                            );
                        }
                      };

                      const reactions = msg.metadata?.reactions || {};
                      const hasReactions = Object.keys(reactions).length > 0;
                      const isRevoked = msg.type === 'revoked';
                      const shouldRenderMessageText =
                        !isRevoked &&
                        (attachmentInfo?.caption || messageText) &&
                        (!attachmentInfo ||
                          ((attachmentInfo.caption || messageText) !== attachmentInfo.filename &&
                            (attachmentInfo.caption || messageText) !== attachmentInfo.src));

                      return (
                        <div
                          key={getMessageKey(msg)}
                          className={`message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`}
                        >
                          <div className="message-bubble-container">
                            <div
                              className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} ${msg.status} ${
                                isMediaMessage ? 'media-type' : ''
                              } ${isRevoked ? 'revoked-type' : ''}`}
                            >
                              {/* Quoted message display */}
                              {quotedMessageBody && (
                                <div className="message-quote-box">
                                  <div className="quote-body">{quotedMessageBody}</div>
                                </div>
                              )}

                              {renderMedia()}

                              {isRevoked ? (
                                <div className="message-text">{t('chats.messageDeleted')}</div>
                              ) : shouldRenderMessageText ? (
                                <div className="message-text">{renderMessageBody(attachmentInfo?.caption || messageText)}</div>
                              ) : !renderInfo.shouldRender ? (
                                <div className="message-text message-text-fallback">{renderInfo.fallbackLabel}</div>
                              ) : (
                                null
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
                              : getChatDisplayName(activeChat, contactPhone || directPhoneCandidate),
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
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,audio/mpeg,audio/mp3,audio/ogg,audio/wav"
                      style={{ display: 'none' }}
                    />

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

                    <textarea
                      placeholder={
                        canWrite
                          ? attachment
                            ? t('chats.captionPlaceholder')
                            : t('chats.messagePlaceholder')
                          : t('chats.noPermission')
                      }
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      rows={1}
                      disabled={!canWrite || sending}
                      className="message-text-input"
                    />
                    {messageInput.trim() || attachment ? (
                      <button
                        type="submit"
                        disabled={!canWrite || (!messageInput.trim() && !attachment) || sending}
                        className="btn-send-message"
                        aria-label={t('chats.send')}
                      >
                        {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="btn-send-message btn-mic-message"
                        aria-label="Voice note"
                        title="Voice note"
                      >
                        <Mic size={18} />
                      </button>
                    )}
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
                            <div className="chat-info-value">
                              {getChatDisplayName(activeChat, contactPhone || directPhoneCandidate)}
                            </div>
                          </div>
                          <div className="chat-info-group">
                            <span className="chat-info-label">{isLidChatId(activeChat.id) ? 'WhatsApp ID' : 'Chat ID'}</span>
                            <code className="chat-info-value">
                              {isLidChatId(activeChat.id)
                                ? 'Private ID hidden. Phone number shown above when available.'
                                : activeChat.id}
                            </code>
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
              {activeMediaPreview && (
                <div className="chat-media-lightbox" role="dialog" aria-modal="true" onClick={closeMediaPreview}>
                  <div className="chat-media-lightbox-backdrop" />
                  <div className="chat-media-lightbox-content" onClick={event => event.stopPropagation()}>
                    <button
                      type="button"
                      className="chat-media-lightbox-close"
                      onClick={closeMediaPreview}
                      aria-label="Close preview"
                    >
                      <X size={18} />
                    </button>
                    {activeMediaPreview.kind === 'image' ? (
                      <img src={activeMediaPreview.src} alt={activeMediaPreview.filename} className="chat-media-lightbox-image" />
                    ) : activeMediaPreview.kind === 'video' ? (
                      <video src={activeMediaPreview.src} controls autoPlay className="chat-media-lightbox-video" />
                    ) : null}
                    <div className="chat-media-lightbox-meta">
                      <strong>{activeMediaPreview.filename}</strong>
                      <span>
                        {[activeMediaPreview.mimetype, formatFileSize(activeMediaPreview.size)].filter(Boolean).join(' - ')}
                      </span>
                    </div>
                  </div>
                </div>
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
