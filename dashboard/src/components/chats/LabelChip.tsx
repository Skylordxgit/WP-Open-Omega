import { X } from 'lucide-react';
import type { Label } from '../../services/api';

// Pick black/white text for legibility against the chip's background color.
function readableText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  // Perceived luminance (sRGB).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#ffffff';
}

interface LabelChipProps {
  label: Label;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

export function LabelChip({ label, onRemove, size = 'sm' }: LabelChipProps) {
  return (
    <span
      className={`label-chip label-chip--${size}`}
      style={{ background: label.color, color: readableText(label.color) }}
      title={label.name}
    >
      <span className="label-chip__name">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          className="label-chip__remove"
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${label.name}`}
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}
