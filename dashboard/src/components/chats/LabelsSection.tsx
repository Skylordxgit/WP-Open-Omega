import { useState } from 'react';
import { Tag, Plus, Check, Trash2, Pencil, X } from 'lucide-react';
import type { Label } from '../../services/api';
import { LabelChip } from './LabelChip';
import {
  useLabelsQuery,
  useSessionLabelsQuery,
  useCreateLabelMutation,
  useUpdateLabelMutation,
  useDeleteLabelMutation,
  useAssignLabelMutation,
  useUnassignLabelMutation,
} from '../../hooks/queries';

const PALETTE = ['#18b561', '#2563eb', '#e11d48', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'];

interface LabelsSectionProps {
  sessionId: string;
  chatId: string;
}

// Labels block for the Chat Info drawer: shows assigned chips and a picker to
// create / rename / delete / color labels and assign/remove them on this chat.
export function LabelsSection({ sessionId, chatId }: LabelsSectionProps) {
  const { data: allLabels = [] } = useLabelsQuery();
  const { data: sessionLabels = {} } = useSessionLabelsQuery(sessionId);
  const assigned = sessionLabels[`${sessionId}::${chatId}`] ?? [];
  const assignedIds = new Set(assigned.map(l => l.id));

  const createLabel = useCreateLabelMutation();
  const updateLabel = useUpdateLabelMutation();
  const deleteLabel = useDeleteLabelMutation();
  const assign = useAssignLabelMutation();
  const unassign = useUnassignLabelMutation();

  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[0]);
  const [editing, setEditing] = useState<Label | null>(null);

  const toggle = (label: Label) => {
    if (assignedIds.has(label.id)) {
      unassign.mutate({ sessionId, chatId, labelId: label.id });
    } else {
      assign.mutate({ sessionId, chatId, labelId: label.id });
    }
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    createLabel.mutate(
      { name, color: newColor },
      {
        onSuccess: created => {
          assign.mutate({ sessionId, chatId, labelId: created.id });
          setNewName('');
          setNewColor(PALETTE[0]);
        },
      },
    );
  };

  const saveEdit = () => {
    if (!editing) return;
    updateLabel.mutate({ id: editing.id, data: { name: editing.name.trim(), color: editing.color } });
    setEditing(null);
  };

  return (
    <div className="chat-info-section">
      <div className="chat-info-section-title">
        <Tag size={12} /> <span>Labels</span>
      </div>

      {assigned.length === 0 ? (
        <div className="chat-info-empty">No labels yet</div>
      ) : (
        <div className="label-chip-row">
          {assigned.map(l => (
            <LabelChip key={l.id} label={l} size="md" onRemove={() => unassign.mutate({ sessionId, chatId, labelId: l.id })} />
          ))}
        </div>
      )}

      {!picking ? (
        <button type="button" className="label-add-btn" onClick={() => setPicking(true)}>
          <Plus size={14} /> Add Label
        </button>
      ) : (
        <div className="label-picker">
          <div className="label-picker__head">
            <span>Labels</span>
            <button type="button" className="label-picker__close" onClick={() => setPicking(false)} aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <div className="label-picker__list">
            {allLabels.length === 0 && <div className="chat-info-empty">No labels created yet.</div>}
            {allLabels.map(label =>
              editing?.id === label.id ? (
                <div key={label.id} className="label-edit-row">
                  <input
                    className="label-edit-input"
                    value={editing.name}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    maxLength={60}
                  />
                  <div className="label-color-dots">
                    {PALETTE.map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`label-color-dot${editing.color === c ? ' selected' : ''}`}
                        style={{ background: c }}
                        onClick={() => setEditing({ ...editing, color: c })}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  <div className="label-edit-actions">
                    <button type="button" className="label-icon-btn" onClick={saveEdit} aria-label="Save">
                      <Check size={14} />
                    </button>
                    <button type="button" className="label-icon-btn" onClick={() => setEditing(null)} aria-label="Cancel">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div key={label.id} className="label-row">
                  <button type="button" className="label-row__main" onClick={() => toggle(label)}>
                    <span className="label-row__dot" style={{ background: label.color }} />
                    <span className="label-row__name">{label.name}</span>
                    {assignedIds.has(label.id) && <Check size={14} className="label-row__check" />}
                  </button>
                  <div className="label-row__actions">
                    <button type="button" className="label-icon-btn" onClick={() => setEditing(label)} aria-label={`Edit ${label.name}`}>
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="label-icon-btn danger"
                      onClick={() => deleteLabel.mutate(label.id)}
                      aria-label={`Delete ${label.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="label-create">
            <input
              className="label-create__input"
              placeholder="New label name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              maxLength={60}
              onKeyDown={e => e.key === 'Enter' && create()}
            />
            <div className="label-color-dots">
              {PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`label-color-dot${newColor === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
            <button type="button" className="label-create__btn" onClick={create} disabled={!newName.trim()}>
              <Plus size={14} /> Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
