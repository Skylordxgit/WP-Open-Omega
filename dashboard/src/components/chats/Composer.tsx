import { memo } from 'react';
import { Paperclip, Smile, Mic, Send, Loader2, X } from 'lucide-react';
import type { ChatMessageView } from './types';

interface ComposerProps {
  canWrite: boolean;
  sending: boolean;
  messageInput: string;
  attachment: { file: File; filename: string } | null;
  previewUrl: string | null;
  showEmojiPicker: boolean;
  replyingTo: ChatMessageView | null;
  replyingToTitle: string;
  replyingToBody: string;
  popularEmojis: string[];
  attachTitle: string;
  emojiTitle: string;
  messagePlaceholder: string;
  captionPlaceholder: string;
  noPermissionPlaceholder: string;
  sendLabel: string;
  onMessageInputChange: (value: string) => void;
  onSend: (e?: React.FormEvent) => void;
  onTriggerFileSelect: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: () => void;
  onToggleEmojiPicker: () => void;
  onEmojiClick: (emoji: string) => void;
  onCloseReply: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

// Compact WhatsApp-Desktop-style composer: attachment / emoji / text / mic / send, plus the
// attachment preview, emoji picker, and reply-preview banners that sit directly above it. Sticky
// at the bottom of the conversation column — owns no business logic, only emits intents.
export const Composer = memo(function Composer({
  canWrite,
  sending,
  messageInput,
  attachment,
  previewUrl,
  showEmojiPicker,
  replyingTo,
  replyingToTitle,
  replyingToBody,
  popularEmojis,
  attachTitle,
  emojiTitle,
  messagePlaceholder,
  captionPlaceholder,
  noPermissionPlaceholder,
  sendLabel,
  onMessageInputChange,
  onSend,
  onTriggerFileSelect,
  onFileChange,
  onRemoveAttachment,
  onToggleEmojiPicker,
  onEmojiClick,
  onCloseReply,
  fileInputRef,
}: ComposerProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
    // Shift+Enter: browsers naturally insert nothing extra here since this is a single-line
    // <input>; if a future change makes this a <textarea>, the newline insert is the default
    // browser behavior and this handler simply doesn't intercept it.
  };

  return (
    <>
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
          <button className="btn-remove-attachment" onClick={onRemoveAttachment} aria-label="Remove attachment">
            <X size={18} />
          </button>
        </div>
      )}

      {showEmojiPicker && (
        <div className="chats-emoji-picker">
          <div className="emoji-grid">
            {popularEmojis.map(emoji => (
              <button key={emoji} type="button" className="emoji-btn" onClick={() => onEmojiClick(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {replyingTo && (
        <div className="replying-preview-banner">
          <div className="replying-preview-content">
            <div className="replying-to-title">{replyingToTitle}</div>
            <div className="replying-to-body">{replyingToBody}</div>
          </div>
          <button className="btn-close-reply" onClick={onCloseReply} aria-label="Cancel reply">
            <X size={18} />
          </button>
        </div>
      )}

      <footer className="room-input-footer">
        <form
          onSubmit={e => {
            e.preventDefault();
            onSend(e);
          }}
          className="input-form"
        >
          <input type="file" ref={fileInputRef} onChange={onFileChange} style={{ display: 'none' }} />

          <button
            type="button"
            onClick={onTriggerFileSelect}
            disabled={!canWrite || sending}
            className="btn-input-accessory"
            title={attachTitle}
            aria-label={attachTitle}
          >
            <Paperclip size={20} />
          </button>

          <button
            type="button"
            onClick={onToggleEmojiPicker}
            disabled={!canWrite || sending}
            className={`btn-input-accessory ${showEmojiPicker ? 'active' : ''}`}
            title={emojiTitle}
            aria-label={emojiTitle}
          >
            <Smile size={20} />
          </button>

          <input
            type="text"
            placeholder={canWrite ? (attachment ? captionPlaceholder : messagePlaceholder) : noPermissionPlaceholder}
            value={messageInput}
            onChange={e => onMessageInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
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
            aria-label={sendLabel}
          >
            {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          </button>
        </form>
      </footer>
    </>
  );
});
