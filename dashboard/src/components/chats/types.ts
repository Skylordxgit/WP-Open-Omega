import type { Chat, ChatMessage } from '../../services/api';

// `data` (base64) is only present after an explicit on-demand download — inbound media is never
// auto-downloaded. `size`/`duration` are lightweight metadata captured at receive time so the
// not-yet-downloaded placeholder can show a WhatsApp-style file size / voice-note duration.
export type MessageMedia = {
  mimetype: string;
  filename?: string;
  data?: string;
  size?: number;
  duration?: number;
};

// A chat as shown in the merged inbox carries the id of the channel (session) it came from, since
// the same inbox can show chats pulled from several connected WhatsApp accounts at once.
export interface ChatWithSession extends Chat {
  sessionId: string;
}

export interface ChatMessageView extends ChatMessage {
  metadata?: {
    media?: MessageMedia;
    quotedMessage?: { id: string; body: string };
    reactions?: Record<string, string>;
  };
}

export type MediaDownloadStatus = 'loading' | 'error';
