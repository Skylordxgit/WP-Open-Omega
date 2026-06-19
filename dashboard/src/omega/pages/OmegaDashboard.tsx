import { useQuery } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaDashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['omega-dashboard'], queryFn: omegaApi.dashboard });

  if (isLoading) return <div className="omega-card">Loading Omega dashboard...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  const stats = data!.stats;
  return (
    <div className="omega-page">
      <section className="omega-grid omega-grid-stats">
        {[
          ['Clients', stats.totalClients, `${stats.activeClients} active / ${stats.suspendedClients} suspended`],
          ['Sessions', stats.totalSessions, `${stats.connectedSessions} connected / ${stats.reconnectSessions} reconnect`],
          ['Messages This Month', stats.messagesThisMonth.toLocaleString(), `${stats.messagesToday.toLocaleString()} sent today`],
          ['Admin Staff', stats.staffCount, `${stats.plans} plans configured`],
        ].map(([label, value, meta]) => (
          <article key={String(label)} className="omega-stat-card">
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{meta}</small>
          </article>
        ))}
      </section>

      <section className="omega-grid omega-grid-two">
        <article className="omega-card">
          <div className="omega-card-header">
            <div>
              <h2>Monthly Usage Trend</h2>
              <p>Mock-ready structure for future OpenWA message ingestion.</p>
            </div>
          </div>
          <div className="omega-chart">
            {data!.monthlyTrend.map(point => (
              <div key={point.month} className="omega-chart-row">
                <span>{point.month}</span>
                <div className="omega-chart-bar-wrap">
                  <div className="omega-chart-bar" style={{ width: `${Math.max(10, point.messages / 1200)}%` }} />
                </div>
                <strong>{point.messages.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="omega-card">
          <div className="omega-card-header">
            <div>
              <h2>Reconnect Queue</h2>
              <p>Sessions needing manual intervention or device replacement.</p>
            </div>
          </div>
          <div className="omega-list">
            {data!.reconnectQueue.length === 0 && <p className="omega-empty">No sessions currently need reconnect support.</p>}
            {data!.reconnectQueue.map(item => (
              <div key={item.id} className="omega-list-item">
                <div>
                  <strong>{item.openwaSessionName ?? item.openwaSessionId}</strong>
                  <p>{item.companyName ?? 'Unassigned pool'}</p>
                </div>
                <span className="omega-badge warning">{item.phoneNumber ?? 'No phone'}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      {data!.usageFallbackUsed && (
        <div className="omega-inline-error">
          Usage is currently using fallback values. Configure live OpenWA sync and real traffic to remove fallback mode.
        </div>
      )}

      <section className="omega-card">
        <div className="omega-card-header">
          <div>
            <h2>Top Client Usage</h2>
            <p>Current-month activity across managed SaaS accounts.</p>
          </div>
        </div>
        <div className="omega-table">
          <div className="omega-table-head">
            <span>Client</span>
            <span>Messages</span>
          </div>
          {data!.topClients.map(client => (
            <div key={client.clientId} className="omega-table-row">
              <span>{client.companyName}</span>
              <strong>{client.units.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
