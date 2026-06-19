import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaLimits() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['omega-clients'], queryFn: omegaApi.clients });

  if (isLoading) return <div className="omega-card">Loading limits...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  return (
    <div className="omega-page">
      <section className="omega-card">
        <div className="omega-card-header">
          <div>
            <h2>Message Limits Management</h2>
            <p>Phase 1 keeps this in the super-admin layer so suspended or over-limit clients can be managed centrally.</p>
          </div>
        </div>
        <div className="omega-table">
          <div className="omega-table-head omega-table-head-clients">
            <span>Client</span>
            <span>Plan</span>
            <span>Monthly Limit</span>
            <span>Usage This Month</span>
            <span>WhatsApp Limit</span>
            <span>Update</span>
          </div>
          {data.map(client => (
            <div key={client.id} className="omega-table-row omega-table-head-clients">
              <div>
                <strong>{client.companyName}</strong>
                <p>{client.status}</p>
              </div>
              <span>{client.planName ?? 'Custom'}</span>
              <span>{client.monthlyMessageLimit.toLocaleString()}</span>
              <span>{(client.usageThisMonth ?? 0).toLocaleString()}</span>
              <span>{client.whatsappAccountLimit}</span>
              <Link to={`/omega/clients/${client.id}/edit`}>Adjust Limits</Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
