import { useQuery } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaUsage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['omega-usage'], queryFn: omegaApi.usage });

  if (isLoading) return <div className="omega-card">Loading usage...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  return (
    <div className="omega-page">
      <section className="omega-grid omega-grid-stats">
        <article className="omega-stat-card">
          <span>Current Month</span>
          <strong>{data!.currentMonth}</strong>
          <small>Billing and quota tracking window</small>
        </article>
        <article className="omega-stat-card">
          <span>Messages Today</span>
          <strong>{data!.totals.messagesToday.toLocaleString()}</strong>
          <small>Real outbound traffic today</small>
        </article>
        <article className="omega-stat-card">
          <span>Total Messages This Month</span>
          <strong>{data!.totals.messagesThisMonth.toLocaleString()}</strong>
          <small>All client traffic for the month</small>
        </article>
        <article className="omega-stat-card">
          <span>Reconnect Actions</span>
          <strong>{data!.totals.reconnections}</strong>
          <small>Support interventions this month</small>
        </article>
      </section>

      <section className="omega-grid omega-grid-two">
        <article className="omega-card">
          <h2>Monthly Trend</h2>
          <div className="omega-chart">
            {data!.trend.map(point => (
              <div key={point.month} className="omega-chart-row">
                <span>{point.month}</span>
                <div className="omega-chart-bar-wrap">
                  <div className="omega-chart-bar" style={{ width: `${Math.max(12, point.messages / 1200)}%` }} />
                </div>
                <strong>{point.messages.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="omega-card">
          <h2>Per-Client Usage</h2>
          <div className="omega-list">
            {data!.perClient.map(client => (
              <div key={client.clientId} className="omega-list-item">
                <div>
                  <strong>{client.companyName}</strong>
                  <p>
                    {client.sessionCount} sessions / {client.whatsappAccountLimit} allowed
                  </p>
                </div>
                <span className="omega-badge neutral">
                  {client.messagesThisMonth.toLocaleString()} / {client.monthlyMessageLimit.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="omega-card">
        <div className="omega-card-header">
          <div>
            <h2>Per-Session Usage</h2>
            <p>Current month outbound volume grouped by synced OpenWA session.</p>
          </div>
        </div>
        <div className="omega-table">
          <div className="omega-table-head omega-table-head-usage-session">
            <span>Session</span>
            <span>Client</span>
            <span>Messages This Month</span>
          </div>
          {data!.bySession.map(session => (
            <div key={session.sessionId} className="omega-table-row omega-table-head-usage-session">
              <div>
                <strong>{session.openwaSessionName ?? session.openwaSessionId}</strong>
                <p>{session.openwaSessionId}</p>
              </div>
              <span>{data!.perClient.find(client => client.clientId === session.clientId)?.companyName ?? 'Unassigned'}</span>
              <strong>{session.messagesThisMonth.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </section>

      {data!.fallbackUsed && (
        <div className="omega-inline-error">
          Usage fallback mode is active because real synced traffic is not fully available yet.
        </div>
      )}
    </div>
  );
}
