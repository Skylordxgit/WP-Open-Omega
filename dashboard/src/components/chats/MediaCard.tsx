import { memo } from 'react';
import { Loader2, Download, FileText, Mic, Image as ImageIcon, Film, Music } from 'lucide-react';
import type { ChatMessageView, MediaDownloadStatus, MessageMedia } from './types';
import {
  getMediaSrc,
  getFileExtension,
  formatBytes,
  formatDuration,
  MEDIA_AVAILABLE_LABELS,
} from './helpers';

// Icon for the placeholder tile, sized for the card (larger than the inline quote icon).
function PlaceholderIcon({ type }: { type: string }) {
  switch (type) {
    case 'image':
    case 'sticker':
      return <ImageIcon size={18} />;
    case 'video':
      return <Film size={18} />;
    case 'voice':
      return <Mic size={18} />;
    case 'audio':
      return <Music size={18} />;
    case 'document':
    default:
      return <FileText size={18} />;
  }
}

// A small static waveform shown on voice-note placeholders. Purely decorative (no real samples).
const VOICE_BARS = [6, 11, 16, 9, 14, 7, 12, 5, 10, 15, 8, 13];
function VoiceWaveform() {
  return (
    <span className="media-waveform" aria-hidden="true">
      {VOICE_BARS.map((h, i) => (
        <span key={i} style={{ height: `${h}px` }} />
      ))}
    </span>
  );
}

// Placeholder card for a media message whose bytes haven't been downloaded yet (inbound media is
// never auto-downloaded). Renders a WhatsApp-style typed card — image/video/audio show the kind +
// size, voice shows a mic + waveform + duration, documents show the filename + extension badge +
// size, stickers render as a transparent tile — plus a Download/Retry button with loading + error
// states. Presentational only — the actual fetch is owned by the parent (updates state + caches).
export const MediaDownloadPlaceholder = memo(function MediaDownloadPlaceholder({
  type,
  media,
  status,
  onDownload,
}: {
  type: string;
  media?: MessageMedia;
  status: MediaDownloadStatus | 'idle';
  onDownload: () => void;
}) {
  const label = MEDIA_AVAILABLE_LABELS[type] || 'Media available';
  const isVoice = type === 'voice';
  const isDocument = type === 'document';
  const isSticker = type === 'sticker';
  const ext = isDocument ? getFileExtension(media?.filename) : '';
  const sizeText = formatBytes(media?.size);
  const durationText = formatDuration(media?.duration);

  // Secondary line: documents show "<EXT> file · <size>"; timed media show duration; else size.
  const metaParts: string[] = [];
  if (isDocument) {
    if (ext) metaParts.push(`${ext} file`);
    if (sizeText) metaParts.push(sizeText);
  } else if (durationText) {
    metaParts.push(durationText);
  } else if (sizeText) {
    metaParts.push(sizeText);
  }
  const meta = metaParts.join(' · ');
  // Documents lead with the filename; everything else leads with the typed "… available" label.
  const primary = isDocument && media?.filename ? media.filename : label;

  return (
    <div
      className={`message-media-placeholder downloadable type-${type} ${isSticker ? 'sticker' : ''} ${status}`}
    >
      <span className="media-placeholder-icon" aria-hidden="true">
        <PlaceholderIcon type={type} />
        {isDocument && ext && <span className="media-placeholder-ext">{ext}</span>}
      </span>
      <div className="media-placeholder-info">
        <span className="media-placeholder-label">{primary}</span>
        {isVoice && <VoiceWaveform />}
        {meta && <span className="media-placeholder-meta">{meta}</span>}
        {status === 'error' && (
          <span className="media-placeholder-error">Couldn’t load media. Tap to retry.</span>
        )}
      </div>
      <button
        type="button"
        className="media-download-btn"
        onClick={onDownload}
        disabled={status === 'loading'}
        aria-label={status === 'error' ? 'Retry media download' : `Download ${type}`}
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
