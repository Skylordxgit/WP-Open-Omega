import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Package2,
  Smartphone,
  BarChart3,
  ShieldCheck,
  Users2,
  Settings,
  LogOut,
} from 'lucide-react';
import type { OmegaUser } from '../api';

interface OmegaLayoutProps {
  user: OmegaUser;
  onLogout: () => void;
}

const navigation = [
  { to: '/omega', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/omega/clients', label: 'Clients', icon: Building2 },
  { to: '/omega/plans', label: 'Plans', icon: Package2 },
  { to: '/omega/sessions', label: 'WhatsApp Sessions', icon: Smartphone },
  { to: '/omega/usage', label: 'Usage Monitoring', icon: BarChart3 },
  { to: '/omega/limits', label: 'Message Limits', icon: ShieldCheck },
  { to: '/omega/staff', label: 'Admin Users', icon: Users2 },
  { to: '/omega/settings', label: 'Settings', icon: Settings },
];

export function OmegaLayout({ user, onLogout }: OmegaLayoutProps) {
  return (
    <div className="omega-shell">
      <aside className="omega-sidebar">
        <div className="omega-brand">
          <div className="omega-brand-mark">O</div>
          <div>
            <strong>Omega WA API</strong>
            <span>Super Admin Panel</span>
          </div>
        </div>

        <nav className="omega-nav">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/omega'} className={({ isActive }) => `omega-nav-link${isActive ? ' active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="omega-sidebar-footer">
          <div className="omega-user-card">
            <strong>{user.fullName}</strong>
            <span>{user.role.replace('_', ' ')}</span>
          </div>
          <button className="omega-ghost-button omega-logout" onClick={onLogout}>
            <LogOut size={16} />
            <span>Log Out</span>
          </button>
        </div>
      </aside>

      <main className="omega-main">
        <header className="omega-topbar">
          <div>
            <p className="omega-eyebrow">Omega SaaS Layer</p>
            <h1>Internal SaaS operations for OpenWA</h1>
          </div>
          <div className="omega-status-cluster">
            <span className="omega-badge success">OpenWA Admin Unchanged</span>
            <span className="omega-badge neutral">Clients Isolated</span>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
