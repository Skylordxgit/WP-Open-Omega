import { memo } from 'react';
import { Users, User, Search, Info, MoreVertical, Phone, Video } from 'lucide-react';
import type { ChatWithSession } from './types';

interface ConversationHeaderProps {
  chat: ChatWithSession;
  statusLabel: string; // online/typing/last-seen-equivalent status text
  statusOk: boolean;
  showInfo: boolean;
  onSearchClick: () => void;
  onToggleInfo: () => void;
  onMoreClick: () => void;
}

// Simplified conversation header: avatar, name, and a single status line only. Technical/session
// details (channel name, chat id, connection state) live in the info panel, not here.
export const ConversationHeader = memo(function ConversationHeader({
  chat,
  statusLabel,
  statusOk,
  showInfo,
  onSearchClick,
  onToggleInfo,
  onMoreClick,
}: ConversationHeaderProps) {
  return (
    <header className="room-header">
      <div className="room-header-main">
        <div className={`room-avatar ${statusOk ? 'online' : ''}`}>
          {chat.isGroup ? <Users size={21} /> : <User size={21} />}
        </div>
        <div className="room-contact-info">
          <h3>{chat.name || chat.id.split('@')[0]}</h3>
          <div className="room-contact-meta">
            <span className={statusOk ? 'meta-ok' : 'meta-warn'}>{statusLabel}</span>
            <span>{chat.isGroup ? 'Group' : 'Direct'}</span>
          </div>
        </div>
      </div>
      <div className="room-header-actions">
        <button
          type="button"
          disabled
          className="room-action-btn"
          title="Voice calls — coming soon"
          aria-label="Voice call (coming soon)"
        >
          <Phone size={18} />
        </button>
        <button
          type="button"
          disabled
          className="room-action-btn"
          title="Video calls — coming soon"
          aria-label="Video call (coming soon)"
        >
          <Video size={18} />
        </button>
        <button
          type="button"
          className="room-action-btn"
          title="Search conversation"
          aria-label="Search conversation"
          onClick={onSearchClick}
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          className={`room-action-btn ${showInfo ? 'active' : ''}`}
          title="Chat info"
          aria-label="Chat info"
          aria-expanded={showInfo}
          onClick={onToggleInfo}
        >
          <Info size={18} />
        </button>
        <button
          type="button"
          className="room-action-btn"
          title="More options"
          aria-label="More options"
          onClick={onMoreClick}
        >
          <MoreVertical size={18} />
        </button>
      </div>
    </header>
  );
});
