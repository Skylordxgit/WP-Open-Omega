import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaSessions() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { data: currentUser } = useQuery({ queryKey: ['omega-me'], queryFn: omegaApi.me ?? (() => Promise.resolve(null as never)) });
  const { data: sessions = [], isLoading, error } = useQuery({
    queryKey: ['omega-sessions', statusFilter, clientFilter],
    queryFn: () => omegaApi.sessions({ status: statusFilter || undefined, clientId: clientFilter || undefined }),
  });
  const { data: clients = [] } = useQuery({ queryKey: ['omega-clients'], queryFn: omegaApi.clients });
  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const assignMutation = useMutation({
    mutationFn: (payload: { sessionId: string; clientId?: string | null; overrideLimit?: boolean }) =>
      omegaApi.assignSession(payload.sessionId, { clientId: payload.clientId, overrideLimit: payload.overrideLimit }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['omega-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['omega-clients'] });
      void queryClient.invalidateQueries({ queryKey: ['omega-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['omega-usage'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: omegaApi.syncSessions,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['omega-sessions'] }),
  });

  const unassignMutation = useMutation({
    mutationFn: (sessionId: string) => omegaApi.unassignSession(sessionId),
    onSuccess: () => {
      setActiveSessionId(null);
      void queryClient.invalidateQueries({ queryKey: ['omega-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['omega-clients'] });
    },
  });

  const replacementMutation = useMutation({
    mutationFn: (payload: { sessionId: string; replacementRequested: boolean }) =>
      omegaApi.updateReplacement(payload.sessionId, payload.replacementRequested),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['omega-sessions'] });
    },
  });

  if (isLoading) return <div className="omega-card">Loading sessions...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  return (
    <div className="omega-page">
      <div className="omega-page-actions">
        <div>
          <h2>WhatsApp Sessions</h2>
          <p>Real OpenWA session sync with assignment controls, replacement flags, and plan enforcement.</p>
        </div>
        <div className="omega-stack-inline">
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            <option value="connected">Connected</option>
            <option value="disconnected">Disconnected</option>
            <option value="needs_reconnect">Needs reconnect</option>
            <option value="starting">Starting</option>
            <option value="qr_required">QR required</option>
          </select>
          <select value={clientFilter} onChange={event => setClientFilter(event.target.value)}>
            <option value="">All clients</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>
                {client.companyName}
              </option>
            ))}
          </select>
          <button className="omega-ghost-button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? 'Syncing...' : 'Refresh from OpenWA'}
          </button>
        </div>
      </div>

      <section className="omega-card">
        <div className="omega-table">
          <div className="omega-table-head omega-table-head-sessions-phase2">
            <span>Session</span>
            <span>Phone</span>
            <span>Status</span>
            <span>Assigned Client</span>
            <span>Last Active</span>
            <span>Actions</span>
          </div>
          {sessions.map(session => (
            <div key={session.id} className="omega-table-row omega-table-head-sessions-phase2">
              <div>
                <strong>{session.openwaSessionName ?? session.openwaSessionId}</strong>
                <p>{session.openwaSessionId}</p>
              </div>
              <span>{session.phoneNumber ?? 'No phone'}</span>
              <span
                className={`omega-badge ${
                  session.status === 'connected'
                    ? 'success'
                    : session.status === 'needs_reconnect' || session.status === 'qr_required'
                      ? 'warning'
                      : 'neutral'
                }`}
              >
                {session.status}
              </span>
              <span>{session.companyName ?? 'Unassigned pool'}</span>
              <span>{session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : 'No activity yet'}</span>
              <div className="omega-table-actions">
                <button className="omega-link-button" onClick={() => setActiveSessionId(session.id)}>
                  View details
                </button>
                <button className="omega-link-button" onClick={() => syncMutation.mutate()}>
                  Refresh
                </button>
              </div>
            </div>
          ))}
        </div>
        {(assignMutation.error || unassignMutation.error || replacementMutation.error) && (
          <div className="omega-inline-error">
            {((assignMutation.error || unassignMutation.error || replacementMutation.error) as Error).message}
          </div>
        )}
      </section>

      {activeSession && (
        <div className="omega-modal-backdrop" onClick={() => setActiveSessionId(null)}>
          <div className="omega-modal" onClick={event => event.stopPropagation()}>
            <div className="omega-card-header">
              <div>
                <h3>{activeSession.openwaSessionName ?? activeSession.openwaSessionId}</h3>
                <p>{activeSession.openwaSessionId}</p>
              </div>
              <button className="omega-ghost-button" onClick={() => setActiveSessionId(null)}>
                Close
              </button>
            </div>

            <div className="omega-grid omega-grid-two">
              <div className="omega-card omega-card-flat">
                <dl className="omega-definition-list">
                  <div><dt>Phone</dt><dd>{activeSession.phoneNumber ?? 'Not available'}</dd></div>
                  <div><dt>Status</dt><dd>{activeSession.status}</dd></div>
                  <div><dt>Assigned Client</dt><dd>{activeSession.companyName ?? 'Unassigned'}</dd></div>
                  <div><dt>Last Active</dt><dd>{activeSession.lastSeenAt ? new Date(activeSession.lastSeenAt).toLocaleString() : 'No activity yet'}</dd></div>
                </dl>
              </div>

              <div className="omega-card omega-card-flat">
                <label>
                  <span>Assign to Client</span>
                  <select
                    defaultValue={activeSession.clientId ?? ''}
                    onChange={async event => {
                      const clientId = event.target.value || null;
                      if (!clientId) return;
                      try {
                        await assignMutation.mutateAsync({ sessionId: activeSession.id, clientId });
                        setActiveSessionId(null);
                      } catch (err) {
                        const message = err instanceof Error ? err.message : 'Assignment failed';
                        if (
                          currentUser?.role === 'super_admin' &&
                          message.toLowerCase().includes('override')
                        ) {
                          const confirmed = window.confirm(
                            'This client is at the plan limit. Do you want to override and assign this session anyway?',
                          );
                          if (confirmed) {
                            await assignMutation.mutateAsync({
                              sessionId: activeSession.id,
                              clientId,
                              overrideLimit: true,
                            });
                            setActiveSessionId(null);
                          }
                        }
                      }
                    }}
                  >
                    <option value="">Choose client</option>
                    {clients.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.companyName}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="omega-modal-actions">
                  <button
                    className="omega-ghost-button"
                    onClick={() => void unassignMutation.mutateAsync(activeSession.id).then(() => setActiveSessionId(null))}
                  >
                    Unassign
                  </button>
                  <button
                    className="omega-ghost-button"
                    onClick={() =>
                      void replacementMutation.mutateAsync({
                        sessionId: activeSession.id,
                        replacementRequested: !activeSession.replacementRequested,
                      })
                    }
                  >
                    {activeSession.replacementRequested ? 'Clear replacement flag' : 'Mark replacement'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
