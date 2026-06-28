import { memo, useState } from 'react';
import { Users, User, X, Phone, AtSign, Hash, BarChart3, Image as ImageIcon, FileText, StickyNote, Copy, Check } from 'lucide-react';
import type { ChatWithSession } from './types';
import { formatContactDisplay, chatType, formatPhoneDigits } from './helpers';
import { LabelsSection } from './LabelsSection';

interface InfoPanelProps {
  chat: ChatWithSession;
  phone: string;
  channelName: string;
  channelPhone: string;
  isConnected: boolean;
  connectedLabel: string;
  reconnectingLabel: string;
  lastActivityLabel: string;
  unreadCount: number;
  loadedCount: number;
  totalCount: number;
  incomingCount: number;
  outgoingCount: number;
  mediaCount: number;
  noPhoneLabel: string;
  onClose: () => void;
}

// Apple-Contacts-style info panel: Profile / Phone / Channel / Statistics / Labels / Shared Media /
// Shared Files / Notes sections. Persistent column on desktop, overlay on narrower widths (CSS-driven).
export const InfoPanel = memo(function InfoPanel({
  chat,
  phone,
  channelName,
  channelPhone,
  isConnected,
  connectedLabel,
  reconnectingLabel,
  lastActivityLabel,
  unreadCount,
  loadedCount,
  totalCount,
  incomingCount,
  outgoingCount,
  mediaCount,
  noPhoneLabel,
  onClose,
}: InfoPanelProps) {
  const [copied, setCopied] = useState(false);
  const displayName = formatContactDisplay(chat.displayName ?? chat.name, chat.id);
  const type = chatType(chat.id);
  const resolvedPhone = formatPhoneDigits(phone);

  const copyChatId = () => {
    void navigator.clipboard?.writeText(chat.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <div className="chat-info-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="chat-info-panel" role="complementary" aria-label="Chat info">
        <div className="chat-info-header">
          <span className="chat-info-title">Chat info</span>
          <button type="button" className="chat-info-close" onClick={onClose} aria-label="Close chat info">
            <X size={18} />
          </button>
        </div>

        <div className="chat-info-body">
          <div className="chat-info-identity">
            <div className="chat-info-avatar">{chat.isGroup ? <Users size={26} /> : <User size={26} />}</div>
            <div className="chat-info-name">{displayName}</div>
            <span className={`chat-info-type ${type.toLowerCase()}`}>{type} chat</span>
          </div>

          {type === 'Direct' && (
            <div className="chat-info-section">
              <div className="chat-info-section-title">
                <Phone size={12} /> <span>Phone</span>
              </div>
              <div className="chat-info-row">
                <span>Phone</span>
                <strong className="mono">{resolvedPhone || 'Unknown'}</strong>
              </div>
            </div>
          )}

          <div className="chat-info-section">
            <div className="chat-info-section-title">
              <Hash size={12} /> <span>Details</span>
            </div>
            <div className="chat-info-row">
              <span>Chat ID</span>
              <span className="chat-info-chatid">
                <strong className="mono" title={chat.id}>
                  {chat.id}
                </strong>
                <button type="button" className="chat-info-copy" onClick={copyChatId} aria-label="Copy chat ID">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </span>
            </div>
            <div className="chat-info-row">
              <span>Type</span>
              <strong>{type}</strong>
            </div>
            <div className="chat-info-row">
              <span>Last activity</span>
              <strong>{lastActivityLabel || '—'}</strong>
            </div>
            <div className="chat-info-row">
              <span>Unread</span>
              <strong>{unreadCount}</strong>
            </div>
          </div>

          <div className="chat-info-section">
            <div className="chat-info-section-title">
              <AtSign size={12} /> <span>Channel</span>
            </div>
            <div className="chat-info-row">
              <span>Session</span>
              <strong>{channelName}</strong>
            </div>
            <div className="chat-info-row">
              <span>Session phone</span>
              <strong className="mono">{channelPhone || noPhoneLabel}</strong>
            </div>
            <div className="chat-info-row">
              <span>Connection</span>
              <strong className={isConnected ? 'ok' : 'warn'}>
                {isConnected ? connectedLabel : reconnectingLabel}
              </strong>
            </div>
          </div>

          <LabelsSection sessionId={chat.sessionId} chatId={chat.id} />

          <div className="chat-info-section">
            <div className="chat-info-section-title">
              <BarChart3 size={12} /> <span>Statistics</span>
            </div>
            <div className="chat-info-stats">
              <div className="chat-info-stat">
                <strong>{loadedCount}</strong>
                <span>Loaded</span>
              </div>
              <div className="chat-info-stat">
                <strong>{Math.max(totalCount, loadedCount)}</strong>
                <span>Total</span>
              </div>
              <div className="chat-info-stat">
                <strong>{incomingCount}</strong>
                <span>Incoming</span>
              </div>
              <div className="chat-info-stat">
                <strong>{outgoingCount}</strong>
                <span>Outgoing</span>
              </div>
              <div className="chat-info-stat">
                <strong>{mediaCount}</strong>
                <span>Media</span>
              </div>
            </div>
            <div className="chat-info-note">Stats reflect loaded messages only.</div>
          </div>

          <div className="chat-info-section">
            <div className="chat-info-section-title">
              <ImageIcon size={12} /> <span>Shared Media</span>
            </div>
            <div className="chat-info-empty">No media browser yet — open messages to view media inline.</div>
          </div>

          <div className="chat-info-section">
            <div className="chat-info-section-title">
              <FileText size={12} /> <span>Shared Files</span>
            </div>
            <div className="chat-info-empty">No file browser yet — open messages to view documents inline.</div>
          </div>

          <div className="chat-info-section">
            <div className="chat-info-section-title">
              <StickyNote size={12} /> <span>Notes</span>
            </div>
            <div className="chat-info-empty">Notes are not available yet.</div>
          </div>
        </div>
      </aside>
    </>
  );
});
