import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Send,
  Inbox,
  Reply,
  Megaphone,
  MessagesSquare,
  MailWarning,
  AlertTriangle,
  Timer,
  Percent,
  Image as ImageIcon,
  Trophy,
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useDashboardAnalyticsQuery } from '../hooks/queries';
import type { DashboardAnalytics, MetricAvailability } from '../services/api';
import { PageHeader } from '../components/PageHeader';
import { formatContactDisplay } from '../components/chats';
import './Dashboard.css';

// ── Formatting helpers ────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// True when an @lid chat could not be resolved to a name/phone (shown as "Unknown contact").
function isUnresolvedLid(contactName: string | null, chatId: string): boolean {
  return !contactName && chatId.includes('@lid');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleString();
}

function metricDisplay(m: MetricAvailability<number>, format: (v: number) => string): { text: string; note?: string } {
  if (!m.available || m.value === null) return { text: 'Not available', note: m.note };
  return { text: format(m.value) };
}

// ── KPI card ──────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  sub?: string;
  unavailable?: boolean;
  note?: string;
  accent?: 'primary' | 'incoming' | 'outgoing' | 'warning' | 'danger';
}

function KpiCard({ label, value, icon: Icon, sub, unavailable, note, accent = 'primary' }: KpiCardProps) {
  return (
    <div className={`kpi-card kpi-${accent}${unavailable ? ' kpi-unavailable' : ''}`}>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon">
          <Icon size={18} />
        </span>
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {unavailable && note && (
        <div className="kpi-note" title={note}>
          <Info size={12} /> Why?
        </div>
      )}
    </div>
  );
}

// ── Hourly chart (grouped bars, CSS/SVG-free) ─────────────────────────

function HourlyChart({ data }: { data: DashboardAnalytics['hourly'] }) {
  const max = Math.max(1, ...data.map(d => Math.max(d.incoming, d.outgoing)));
  const hasData = data.some(d => d.incoming > 0 || d.outgoing > 0);
  if (!hasData) {
    return <div className="empty-state-inline">No messages recorded today yet.</div>;
  }
  return (
    <div className="hourly-chart">
      <div className="hourly-bars">
        {data.map(d => (
          <div className="hourly-col" key={d.hour} title={`${String(d.hour).padStart(2, '0')}:00 — ${d.incoming} in / ${d.outgoing} out`}>
            <div className="hourly-stack">
              <div className="hourly-bar in" style={{ height: `${(d.incoming / max) * 100}%` }} />
              <div className="hourly-bar out" style={{ height: `${(d.outgoing / max) * 100}%` }} />
            </div>
            {d.hour % 3 === 0 && <span className="hourly-label">{String(d.hour).padStart(2, '0')}</span>}
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <span><i className="dot in" /> Incoming</span>
        <span><i className="dot out" /> Outgoing</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────

export function Dashboard() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const navigate = useNavigate();
  const { data, isLoading, error } = useDashboardAnalyticsQuery();

  if (isLoading) {
    return (
      <div className="dashboard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="dashboard" style={{ padding: '2rem' }}>
        <div className="dashboard-error">
          {error instanceof Error ? error.message : 'Failed to load dashboard analytics.'}
        </div>
      </div>
    );
  }

  const c = data.cards;
  const totalMessages = c.incomingToday + c.outgoingToday;
  const replyRate = metricDisplay(c.replyRate, v => `${Math.round(v * 100)}%`);
  const avgResponse = metricDisplay(c.avgResponseTimeSec, formatDuration);
  const unread = metricDisplay(c.unreadChats, v => v.toLocaleString());

  const incVsOut = data.incomingVsOutgoing;
  const ivoTotal = Math.max(1, incVsOut.incoming + incVsOut.outgoing);
  const bc = data.broadcast;
  const bcTotal = Math.max(1, bc.total);

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle="Real-time messaging analytics from stored message data."
        badge={<span className="status-badge connected">Today · {data.date}</span>}
      />

      {/* ── KPI grid ── */}
      <div className="kpi-grid">
        <KpiCard label="Active sessions" value={c.activeSessions.toLocaleString()} icon={MessageSquare} />
        <KpiCard label="Incoming today" value={c.incomingToday.toLocaleString()} icon={Inbox} accent="incoming" />
        <KpiCard label="Replied chats today" value={c.repliedToday.toLocaleString()} icon={Reply} accent="primary" />
        <KpiCard label="Outgoing today" value={c.outgoingToday.toLocaleString()} icon={Send} accent="outgoing" />
        <KpiCard label="Broadcast sent today" value={c.broadcastToday.toLocaleString()} icon={Megaphone} sub={`${bc.batches} batch${bc.batches === 1 ? '' : 'es'}`} />
        <KpiCard label="Total chats today" value={c.totalChatsToday.toLocaleString()} icon={MessagesSquare} />
        <KpiCard label="Unread chats" value={unread.text} icon={MailWarning} unavailable={!c.unreadChats.available} note={unread.note} />
        <KpiCard label="Failed today" value={c.failedToday.toLocaleString()} icon={AlertTriangle} accent={c.failedToday > 0 ? 'danger' : 'primary'} />
        <KpiCard label="Avg response time" value={avgResponse.text} icon={Timer} unavailable={!c.avgResponseTimeSec.available} note={avgResponse.note} />
        <KpiCard label="Reply rate" value={replyRate.text} icon={Percent} unavailable={!c.replyRate.available} note={replyRate.note} />
        <KpiCard label="Media today" value={c.mediaToday.toLocaleString()} icon={ImageIcon} />
        <KpiCard
          label="Top active session"
          value={c.topSession ? c.topSession.name : '—'}
          icon={Trophy}
          sub={c.topSession ? `${c.topSession.messageCount.toLocaleString()} messages` : 'No activity today'}
        />
      </div>

      {/* ── Charts row ── */}
      <div className="charts-row">
        <section className="panel">
          <div className="panel-head">
            <h2>Messages over time</h2>
            <span className="panel-sub">Hourly · today</span>
          </div>
          <HourlyChart data={data.hourly} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Incoming vs outgoing</h2>
            <span className="panel-sub">{totalMessages.toLocaleString()} total</span>
          </div>
          {totalMessages === 0 ? (
            <div className="empty-state-inline">No messages today.</div>
          ) : (
            <div className="ratio-block">
              <div className="ratio-bar">
                <div className="ratio-seg in" style={{ width: `${(incVsOut.incoming / ivoTotal) * 100}%` }} />
                <div className="ratio-seg out" style={{ width: `${(incVsOut.outgoing / ivoTotal) * 100}%` }} />
              </div>
              <div className="ratio-legend">
                <div className="ratio-item">
                  <span className="ratio-num"><ArrowDownLeft size={16} /> {incVsOut.incoming.toLocaleString()}</span>
                  <span className="ratio-cap">Incoming ({Math.round((incVsOut.incoming / ivoTotal) * 100)}%)</span>
                </div>
                <div className="ratio-item">
                  <span className="ratio-num"><ArrowUpRight size={16} /> {incVsOut.outgoing.toLocaleString()}</span>
                  <span className="ratio-cap">Outgoing ({Math.round((incVsOut.outgoing / ivoTotal) * 100)}%)</span>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Broadcast delivery</h2>
            <span className="panel-sub">{bc.batches} batch{bc.batches === 1 ? '' : 'es'} today</span>
          </div>
          {bc.total === 0 ? (
            <div className="empty-state-inline">No broadcast batches today.</div>
          ) : (
            <div className="ratio-block">
              <div className="ratio-bar">
                <div className="ratio-seg ok" style={{ width: `${(bc.sent / bcTotal) * 100}%` }} />
                <div className="ratio-seg bad" style={{ width: `${(bc.failed / bcTotal) * 100}%` }} />
                <div className="ratio-seg wait" style={{ width: `${(bc.pending / bcTotal) * 100}%` }} />
                <div className="ratio-seg cancel" style={{ width: `${(bc.cancelled / bcTotal) * 100}%` }} />
              </div>
              <div className="bc-stats">
                <div><strong>{bc.sent.toLocaleString()}</strong><span>Sent</span></div>
                <div><strong>{bc.failed.toLocaleString()}</strong><span>Failed</span></div>
                <div><strong>{bc.pending.toLocaleString()}</strong><span>Pending</span></div>
                <div><strong>{bc.cancelled.toLocaleString()}</strong><span>Cancelled</span></div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Session performance ── */}
      <section className="panel">
        <div className="panel-head">
          <h2>Session performance</h2>
          <span className="panel-sub">Today, by volume</span>
        </div>
        {data.sessionPerformance.length === 0 ? (
          <div className="empty-state-inline">No session activity today.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Status</th>
                  <th className="num">Incoming</th>
                  <th className="num">Outgoing</th>
                  <th className="num">Chats</th>
                  <th className="num">Failed</th>
                  <th className="num">Avg response</th>
                </tr>
              </thead>
              <tbody>
                {data.sessionPerformance.map(s => (
                  <tr key={s.sessionId} onClick={() => navigate('/sessions')} className="clickable">
                    <td>{s.name}</td>
                    <td><span className={`status-pill ${s.status}`}>{s.status}</span></td>
                    <td className="num">{s.incoming.toLocaleString()}</td>
                    <td className="num">{s.outgoing.toLocaleString()}</td>
                    <td className="num">{s.chats.toLocaleString()}</td>
                    <td className={`num ${s.failed > 0 ? 'danger-text' : ''}`}>{s.failed.toLocaleString()}</td>
                    <td className="num">{formatDuration(s.avgResponseTimeSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Two-column tables ── */}
      <div className="tables-row">
        <section className="panel">
          <div className="panel-head">
            <h2>Recent active chats</h2>
          </div>
          {data.recentChats.length === 0 ? (
            <div className="empty-state-inline">No active chats today.</div>
          ) : (
            <ul className="list">
              {data.recentChats.map(ch => (
                <li key={`${ch.sessionId}-${ch.chatId}`} className="list-row">
                  <span className={`dir-pill ${ch.lastDirection}`}>
                    {ch.lastDirection === 'incoming' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                  </span>
                  <div className="list-main">
                    <span className="list-title">{formatContactDisplay(ch.contactName, ch.chatId)}</span>
                    <span className="list-sub">
                      {ch.sessionName} · {ch.messageCount} msg
                      {isUnresolvedLid(ch.contactName, ch.chatId) && <span className="lid-hint"> · LID unresolved</span>}
                    </span>
                  </div>
                  <span className="list-time">{formatTime(ch.lastMessageAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Unreplied chats</h2>
            <span className="panel-sub">Awaiting agent reply</span>
          </div>
          {data.unrepliedChats.length === 0 ? (
            <div className="empty-state-inline">All incoming chats have been replied to. 🎉</div>
          ) : (
            <ul className="list">
              {data.unrepliedChats.map(ch => (
                <li key={`${ch.sessionId}-${ch.chatId}`} className="list-row">
                  <span className="dir-pill incoming"><ArrowDownLeft size={14} /></span>
                  <div className="list-main">
                    <span className="list-title">{formatContactDisplay(ch.contactName, ch.chatId)}</span>
                    <span className="list-sub">
                      {ch.sessionName} · {ch.incomingCount} incoming
                      {isUnresolvedLid(ch.contactName, ch.chatId) && <span className="lid-hint"> · LID unresolved</span>}
                    </span>
                  </div>
                  <span className="list-time warn">waiting {formatDuration(ch.waitingSeconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Top contacts</h2>
            <span className="panel-sub">By message count</span>
          </div>
          {data.topContacts.length === 0 ? (
            <div className="empty-state-inline">No contacts today.</div>
          ) : (
            <ul className="list">
              {data.topContacts.map((ct, i) => (
                <li key={`${ct.sessionId}-${ct.chatId}`} className="list-row">
                  <span className="rank">{i + 1}</span>
                  <div className="list-main">
                    <span className="list-title">{formatContactDisplay(ct.contactName, ct.chatId)}</span>
                    <span className="list-sub">
                      {ct.sessionName}
                      {isUnresolvedLid(ct.contactName, ct.chatId) && <span className="lid-hint"> · LID unresolved</span>}
                    </span>
                  </div>
                  <span className="list-time">{ct.messageCount.toLocaleString()} msg</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Failed message log</h2>
            <span className="panel-sub">Today</span>
          </div>
          {data.failedLog.length === 0 ? (
            <div className="empty-state-inline">No failed messages today. 🎉</div>
          ) : (
            <ul className="list">
              {data.failedLog.map(f => (
                <li key={f.id} className="list-row">
                  <span className="dir-pill failed"><AlertTriangle size={14} /></span>
                  <div className="list-main">
                    <span className="list-title">{formatContactDisplay(f.contactName, f.chatId)}</span>
                    <span className="list-sub">{f.error || f.body || `${f.type} message`}</span>
                  </div>
                  <span className="list-time">{formatTime(f.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
