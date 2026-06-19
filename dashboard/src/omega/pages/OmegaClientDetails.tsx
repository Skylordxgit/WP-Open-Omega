import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaClientDetails() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['omega-client', id], queryFn: () => omegaApi.client(id) });

  if (isLoading) return <div className="omega-card">Loading client details...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  return (
    <div className="omega-page">
      <div className="omega-page-actions">
        <div>
          <h2>{data!.companyName}</h2>
          <p>{data!.ownerName} • {data!.email} • {data!.phone}</p>
        </div>
        <div className="omega-stack-inline">
          <span className={`omega-badge ${data!.status === 'active' ? 'success' : 'danger'}`}>{data!.status}</span>
          <Link className="omega-primary-button" to={`/omega/clients/${data!.id}/edit`}>
            Edit Client
          </Link>
        </div>
      </div>

      <section className="omega-grid omega-grid-two">
        <article className="omega-card">
          <h3>Plan & Limits</h3>
          <dl className="omega-definition-list">
            <div><dt>Plan</dt><dd>{data!.plan?.name ?? 'Custom'}</dd></div>
            <div><dt>Message Limit</dt><dd>{data!.monthlyMessageLimit.toLocaleString()}</dd></div>
            <div><dt>WhatsApp Limit</dt><dd>{data!.whatsappAccountLimit}</dd></div>
            <div><dt>Subscription</dt><dd>{data!.subscription?.status ?? 'trial'}</dd></div>
          </dl>
        </article>
        <article className="omega-card">
          <h3>Foundation Metrics</h3>
          <dl className="omega-definition-list">
            <div><dt>Contacts</dt><dd>{data!.contactsCount}</dd></div>
            <div><dt>Contact Groups</dt><dd>{data!.contactGroupsCount}</dd></div>
            <div><dt>Assigned Sessions</dt><dd>{data!.sessions.length}</dd></div>
            <div><dt>Client Staff</dt><dd>{data!.staff.length}</dd></div>
          </dl>
        </article>
      </section>

      <section className="omega-grid omega-grid-two">
        <article className="omega-card">
          <div className="omega-card-header">
            <div>
              <h3>Assigned WhatsApp Sessions</h3>
              <p>Current OpenWA session ownership for this client.</p>
            </div>
          </div>
          <div className="omega-list">
            {data!.sessions.map(session => (
              <div key={session.id} className="omega-list-item">
                <div>
                  <strong>{session.openwaSessionId}</strong>
                  <p>{session.phoneNumber ?? 'No phone'}</p>
                </div>
                <span className={`omega-badge ${session.status === 'connected' ? 'success' : session.status === 'needs_reconnect' ? 'warning' : 'neutral'}`}>
                  {session.status}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="omega-card">
          <div className="omega-card-header">
            <div>
              <h3>Client Staff</h3>
              <p>Users scoped to this tenant for the future SaaS client panel.</p>
            </div>
          </div>
          <div className="omega-list">
            {data!.staff.map(user => (
              <div key={user.id} className="omega-list-item">
                <div>
                  <strong>{user.fullName}</strong>
                  <p>{user.email}</p>
                </div>
                <span className="omega-badge neutral">{user.role}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="omega-card">
        <div className="omega-card-header">
          <div>
            <h3>Recent Usage & Messages</h3>
            <p>Previewing the monthly tracking and message history structure for Phase 2.</p>
          </div>
        </div>
        <div className="omega-grid omega-grid-two">
          <div className="omega-chart">
            {data!.usageSummary.map(point => (
              <div key={point.month} className="omega-chart-row">
                <span>{point.month}</span>
                <div className="omega-chart-bar-wrap">
                  <div className="omega-chart-bar" style={{ width: `${Math.max(12, point.messages / 1200)}%` }} />
                </div>
                <strong>{point.messages.toLocaleString()}</strong>
              </div>
            ))}
          </div>
          <div className="omega-list">
            {data!.recentMessages.map(message => (
              <div key={message.id} className="omega-list-item">
                <div>
                  <strong>{message.recipient}</strong>
                  <p>{message.body}</p>
                </div>
                <span className="omega-badge neutral">{message.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
