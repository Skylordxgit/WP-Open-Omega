import { memo } from 'react';
import { Loader2, Download, FileText, Mic } from 'lucide-react';
import type { ChatMessageView, MediaDownloadStatus } from './types';
import {
  getMediaSrc,
  getFileExtension,
  MEDIA_AVAILABLE_LABELS,
  QuotedMediaIcon,
} from './helpers';

// Placeholder card for a media message whose payload hasn't been downloaded yet. Shows the typed
// "… available" label plus a Download/Retry button with a loading and error state. Presentational
// only — the actual fetch is owned by the parent so it can update message state + cache.
export const MediaDownloadPlaceholder = memo(function MediaDownloadPlaceholder({
  type,
  status,
  onDownload,
}: {
  type: string;
  status: MediaDownloadStatus | 'idle';
  onDownload: () => void;
}) {
  const label = MEDIA_AVAILABLE_LABELS[type] || 'Media available';
  return (
    <div className={`message-media-placeholder downloadable ${status}`}>
      <span className="media-placeholder-icon" aria-hidden="true">
        <QuotedMediaIcon type={type} />
      </span>
      <div className="media-placeholder-info">
        <span className="media-placeholder-label">{label}</span>
        {status === 'error' && (
          <span className="media-placeholder-error">Couldn’t load media. Tap to retry.</span>
        )}
      </div>
      <button
        type="button"
        className="media-download-btn"
        onClick={onDownload}
        disabled={status === 'loading'}
        aria-label={status === 'error' ? 'Retry media download' : 'Download media'}
      >
        {status === 'loading' ? (
          <>
            <Loader2 className="animate-spin" size={14} />
            <span>Loading…</span>
          </>
        ) : (
          <>
            <Download size={14} />
            <span>{status === 'error' ? 'Retry' : 'Download'}</span>
          </>
        )}
      </button>
    </div>
  );
});

// Renders the already-downloaded media for a message (image/video/voice/audio/document/sticker).
// Returns null when there's nothing to show (revoked, or no media payload yet) — the caller falls
// back to the download placeholder in that case. Pure presentation; never triggers a fetch itself.
export const MediaCard = memo(function MediaCard({
  msg,
  downloadLabel,
}: {
  msg: ChatMessageView;
  downloadLabel: string;
}) {
  if (msg.type === 'revoked') return null;
  const mediaInfo = msg.metadata?.media;
  if (!mediaInfo) return null;
  const mediaSrc = getMediaSrc(mediaInfo);
  if (!mediaSrc) return null;

  switch (msg.type) {
    case 'sticker':
      return (
        <div className="message-media-sticker">
          <img src={mediaSrc} alt={mediaInfo.filename || 'Sticker'} className="chat-sticker-media" />
        </div>
      );
    case 'image':
      return (
        <div className="message-media-image">
          <img src={mediaSrc} alt={mediaInfo.filename || 'Image'} className="chat-image-media" />
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
          <a href={mediaSrc} download={mediaInfo.filename || 'document'} className="chat-document-media">
            <span className="doc-icon">
              <FileText size={20} />
              {ext && <span className="doc-ext">{ext}</span>}
            </span>
            <span className="doc-info">
              <span className="doc-name">{mediaInfo.filename || downloadLabel}</span>
              <span className="doc-sub">{ext ? `${ext} file` : downloadLabel}</span>
            </span>
          </a>
        </div>
      );
    }
  }
});
