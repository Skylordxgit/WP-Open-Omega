import { memo } from 'react';
import { Users, User } from 'lucide-react';
import type { ChatWithSession } from './types';
import { formatChatTime, highlightMatch } from './helpers';

interface ChatRowProps {
  chat: ChatWithSession;
  isActive: boolean;
  searchQuery: string;
  yesterdayLabel: string;
  noMessageLabel: string;
  onSelect: () => void;
}

// A single dense, WhatsApp-Desktop-style chat list row (~68px): avatar, name, last-message
// preview, time, unread badge, channel badge, and a selection indicator (left accent bar).
export const ChatRow = memo(function ChatRow({
  chat,
  isActive,
  searchQuery,
  yesterdayLabel,
  noMessageLabel,
  onSelect,
}: ChatRowProps) {
  const displayName = chat.name || chat.id.split('@')[0];
  const snippet = chat.lastMessage || '';

  return (
    <div
      className={`chat-item-card ${isActive ? 'active' : ''} ${(chat.unreadCount || 0) > 0 ? 'has-unread' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="chat-avatar">{chat.isGroup ? <Users size={20} /> : <User size={20} />}</div>

      <div className="chat-item-info">
        <div className="chat-item-top">
          <span className="chat-item-name" title={chat.name || chat.id}>
            {highlightMatch(displayName, searchQuery)}
          </span>
          {chat.timestamp ? (
            <span className="chat-item-time">{formatChatTime(chat.timestamp, yesterdayLabel)}</span>
          ) : null}
        </div>
        <div className="chat-item-bottom">
          <span className="chat-item-snippet" title={snippet}>
            {snippet ? highlightMatch(snippet, searchQuery) : <span className="no-message">{noMessageLabel}</span>}
          </span>
          <div className="chat-item-badges">
            <span className={`chat-type-badge ${chat.isGroup ? 'group' : 'direct'}`}>
              {chat.isGroup ? 'Group' : 'Direct'}
            </span>
            {chat.unreadCount > 0 && <span className="chat-unread-badge">{chat.unreadCount}</span>}
          </div>
        </div>
      </div>
    </div>
  );
});
