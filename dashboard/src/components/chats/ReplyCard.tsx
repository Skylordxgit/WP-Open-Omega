import { memo } from 'react';
import { getQuotedMediaType, QuotedMediaIcon, QUOTE_MEDIA_LABELS } from './helpers';

// WhatsApp-style quoted-message card: vertical accent bar + sender label + one-line truncated
// preview. Clicking it asks the parent to scroll to (and briefly highlight) the original message.
export const ReplyCard = memo(function ReplyCard({
  body,
  onClick,
}: {
  body: string;
  onClick: () => void;
}) {
  const quotedMediaType = getQuotedMediaType(body);
  return (
    <div
      className="message-quote-box"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {quotedMediaType ? (
        <div className="quote-media-label">
          <QuotedMediaIcon type={quotedMediaType} />
          <span>{QUOTE_MEDIA_LABELS[quotedMediaType] || quotedMediaType}</span>
        </div>
      ) : (
        <div className="quote-body">{body}</div>
      )}
    </div>
  );
});
