import { useQuery } from '@tanstack/react-query';
import { omegaApi } from '../api';

export function OmegaSettings() {
  const { data, isLoading, error } = useQuery({ queryKey: ['omega-settings'], queryFn: omegaApi.settings });

  if (isLoading) return <div className="omega-card">Loading settings...</div>;
  if (error) return <div className="omega-inline-error">{(error as Error).message}</div>;

  return (
    <div className="omega-page">
      <section className="omega-grid omega-grid-two">
        <article className="omega-card">
          <h2>Integration Settings</h2>
          <dl className="omega-definition-list">
            <div><dt>Omega API Namespace</dt><dd>{data!.architecture.omegaLayer}</dd></div>
            <div><dt>OpenWA API Base</dt><dd>{data!.architecture.openwaApiBaseUrl}</dd></div>
            <div><dt>OpenWA Sync Base URL</dt><dd>{data!.architecture.openwaBaseUrl}</dd></div>
            <div><dt>OpenWA HTTP Client Configured</dt><dd>{data!.architecture.openwaHttpClientConfigured ? 'Yes' : 'No (local service fallback)'}</dd></div>
            <div><dt>Master Key Stored Only in Backend</dt><dd>{data!.architecture.credentialsStoredInBackendOnly ? 'Yes' : 'No'}</dd></div>
            <div><dt>Existing OpenWA Admin Untouched</dt><dd>{data!.architecture.existingAdminPanelUntouched ? 'Yes' : 'No'}</dd></div>
          </dl>
        </article>

        <article className="omega-card">
          <h2>Operational State</h2>
          <dl className="omega-definition-list">
            <div><dt>Active Admin Sessions</dt><dd>{data!.operations.activeAdminSessions}</dd></div>
            <div><dt>Total Clients</dt><dd>{data!.operations.totalClients}</dd></div>
            <div><dt>Total Sessions</dt><dd>{data!.operations.totalSessions}</dd></div>
            <div><dt>Token TTL</dt><dd>{data!.operations.authSessionTtlHours} hours</dd></div>
          </dl>
        </article>
      </section>

      <section className="omega-card">
        <h2>Seeded Accounts</h2>
        <p className="omega-helper-text">
          These default emails are seeded from backend env vars and are intended for first-run access only. Change them in your
          deployment configuration before production rollout.
        </p>
        <div className="omega-list">
          <div className="omega-list-item">
            <div>
              <strong>Super Admin</strong>
              <p>{data!.defaultAccounts.superAdminEmail}</p>
            </div>
            <span className="omega-badge success">Seeded</span>
          </div>
          <div className="omega-list-item">
            <div>
              <strong>Support Admin</strong>
              <p>{data!.defaultAccounts.supportAdminEmail}</p>
            </div>
            <span className="omega-badge neutral">Seeded</span>
          </div>
        </div>
      </section>
    </div>
  );
}
