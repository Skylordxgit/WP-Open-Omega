import { useState } from 'react';

interface OmegaLoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function OmegaLogin({ onLogin }: OmegaLoginProps) {
  const [email, setEmail] = useState('admin@omega.local');
  const [password, setPassword] = useState('ChangeMe123!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="omega-login-shell">
      <div className="omega-login-card">
        <div className="omega-login-copy">
          <p className="omega-eyebrow">Omega WA API</p>
          <h1>Super Admin Control Center</h1>
          <p>
            Manage SaaS clients, subscription limits, WhatsApp session assignment, and support operations without exposing
            the underlying OpenWA technical dashboard to clients.
          </p>
        </div>

        <form className="omega-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input value={email} onChange={event => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            <span>Password</span>
            <input value={password} onChange={event => setPassword(event.target.value)} type="password" />
          </label>
          {error && <div className="omega-inline-error">{error}</div>}
          <button className="omega-primary-button" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Access Omega Admin'}
          </button>
          <p className="omega-helper-text">
            Default seeded credentials come from backend env vars `OMEGA_ADMIN_EMAIL` and `OMEGA_ADMIN_PASSWORD`.
          </p>
        </form>
      </div>
    </div>
  );
}
