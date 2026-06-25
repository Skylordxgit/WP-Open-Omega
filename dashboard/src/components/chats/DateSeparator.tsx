import { memo } from 'react';

// "Today / Yesterday / actual date" divider inserted between message groups.
export const DateSeparator = memo(function DateSeparator({ label }: { label: string }) {
  return (
    <div className="message-date-separator">
      <span>{label}</span>
    </div>
  );
});
