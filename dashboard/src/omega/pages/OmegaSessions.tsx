import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaSessions() {
  const queryClient = useQueryClient();
  const { data: sessions = [], isLoading, error } = useQuery({ queryKey: ['omega-sessions'], queryFn: omegaApi.sessions });
  const { data: clients = [] } = useQuery({ queryKey: ['omega-clients'], queryFn: omegaApi.clients });

  const assignMutation = useMutation({
    mutationFn: (payload: { sessionId: string; clientId?: string | null }) => omegaApi.assignSession(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['omega-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['omega-clients'] });
      void queryClient.invalidateQueries({ queryKey: ['omega-dashboard'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: omegaApi.syncMockSessions,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['omega-sessions'] }),
  });

  if (isLoading) return <div className="omega-card">Loading sessions...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  return (
    <div className="omega-page">
      <div className="omega-page-actions">
        <div>
          <h2>WhatsApp Sessions</h2>
          <p>Assign one OpenWA session to one client at a time and keep reconnect work visible to support.</p>
        </div>
        <button className="omega-ghost-button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? 'Syncing...' : 'Load Mock OpenWA Sessions'}
        </button>
      </div>

      <section className="omega-card">
        <div className="omega-table">
          <div className="omega-table-head omega-table-head-sessions">
            <span>OpenWA Session</span>
            <span>Phone</span>
            <span>Status</span>
            <span>Assigned Client</span>
            <span>Action</span>
          </div>
          {sessions.map(session => (
            <div key={session.id} className="omega-table-row omega-table-head-sessions">
              <div>
                <strong>{session.openwaSessionId}</strong>
                <p>{session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : 'No last seen yet'}</p>
              </div>
              <span>{session.phoneNumber ?? 'No phone'}</span>
              <span className={`omega-badge ${session.status === 'connected' ? 'success' : session.status === 'needs_reconnect' ? 'warning' : 'neutral'}`}>
                {session.status}
              </span>
              <span>{session.companyName ?? 'Unassigned pool'}</span>
              <select
                value={session.clientId ?? ''}
                onChange={event =>
                  assignMutation.mutate({
                    sessionId: session.id,
                    clientId: event.target.value || null,
                  })
                }
              >
                <option value="">Unassigned</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.companyName}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {assignMutation.error && <div className="omega-inline-error">{(assignMutation.error as Error).message}</div>}
      </section>
    </div>
  );
}
