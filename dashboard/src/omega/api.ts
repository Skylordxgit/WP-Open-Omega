import { API_BASE_URL } from '../services/api';

export type OmegaRole = 'super_admin' | 'support_admin' | 'client_admin' | 'client_agent';

export interface OmegaUser {
  id: string;
  fullName: string;
  email: string;
  role: OmegaRole;
  status: 'active' | 'invited' | 'suspended';
  clientId?: string | null;
  companyName?: string | null;
  lastLoginAt?: string | null;
}

export interface OmegaClient {
  id: string;
  companyName: string;
  ownerName: string;
  email: string;
  phone: string;
  status: 'active' | 'suspended';
  planId?: string | null;
  planName?: string;
  monthlyMessageLimit: number;
  whatsappAccountLimit: number;
  createdAt: string;
  sessionCount?: number;
  connectedSessions?: number;
  usageThisMonth?: number;
  subscriptionStatus?: string;
  userCount?: number;
}

export interface OmegaPlan {
  id: string;
  name: string;
  description?: string | null;
  monthlyMessageLimit: number;
  whatsappAccountLimit: number;
  monthlyPrice: number;
  features: string[];
  isActive: boolean;
  activeClients?: number;
}

export interface OmegaSession {
  id: string;
  openwaSessionId: string;
  clientId?: string | null;
  companyName?: string | null;
  phoneNumber?: string | null;
  status: 'connected' | 'disconnected' | 'needs_reconnect';
  assignedToClient: boolean;
  lastSeenAt?: string | null;
  createdAt: string;
}

export interface OmegaUsageOverview {
  currentMonth: string;
  totals: { messages: number; reconnections: number };
  perClient: Array<{
    clientId: string;
    companyName: string;
    status: string;
    messages: number;
    monthlyMessageLimit: number;
    sessionCount: number;
    whatsappAccountLimit: number;
  }>;
  trend: Array<{ month: string; messages: number; reconnects: number }>;
}

export interface OmegaDashboardSummary {
  brandName: string;
  stats: {
    totalClients: number;
    activeClients: number;
    suspendedClients: number;
    plans: number;
    totalSessions: number;
    connectedSessions: number;
    reconnectSessions: number;
    unassignedSessions: number;
    messagesThisMonth: number;
    staffCount: number;
    contactCount: number;
    contactGroupCount: number;
    campaigns: number;
  };
  monthlyTrend: Array<{ month: string; messages: number; reconnects: number }>;
  topClients: Array<{ clientId: string; companyName: string; units: number }>;
  reconnectQueue: Array<{
    id: string;
    openwaSessionId: string;
    phoneNumber?: string | null;
    companyName?: string | null;
    lastSeenAt?: string | null;
  }>;
}

export interface OmegaClientDetails extends OmegaClient {
  plan?: OmegaPlan | null;
  subscription?: {
    status: string;
    monthlyMessageLimit: number;
    whatsappAccountLimit: number;
    startsAt?: string | null;
    endsAt?: string | null;
  } | null;
  sessions: OmegaSession[];
  usageSummary: Array<{ month: string; messages: number; reconnects: number }>;
  staff: OmegaUser[];
  recentMessages: Array<{
    id: string;
    recipient: string;
    direction: string;
    status: string;
    body: string;
    sentAt?: string | null;
    createdAt: string;
  }>;
  contactsCount: number;
  contactGroupsCount: number;
}

export interface OmegaSettings {
  brandName: string;
  architecture: {
    omegaLayer: string;
    openwaApiBaseUrl: string;
    openwaMasterKeyConfigured: boolean;
    credentialsStoredInBackendOnly: boolean;
    existingAdminPanelUntouched: boolean;
  };
  operations: {
    activeAdminSessions: number;
    totalClients: number;
    totalSessions: number;
    authSessionTtlHours: number;
  };
  defaultAccounts: {
    superAdminEmail: string;
    supportAdminEmail: string;
  };
}

const OMEGA_TOKEN_KEY = 'omega_admin_token';

export function getOmegaToken() {
  return sessionStorage.getItem(OMEGA_TOKEN_KEY);
}

export function setOmegaToken(token: string) {
  sessionStorage.setItem(OMEGA_TOKEN_KEY, token);
}

export function clearOmegaToken() {
  sessionStorage.removeItem(OMEGA_TOKEN_KEY);
}

async function parseJson(response: Response) {
  if (response.status === 204) {
    return null;
  }
  return response.json().catch(() => ({}));
}

async function omegaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getOmegaToken();
  const response = await fetch(`${API_BASE_URL}/omega${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await parseJson(response);
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : Array.isArray(payload?.message)
          ? payload.message.join(', ')
          : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return (await parseJson(response)) as T;
}

export async function omegaLogin(email: string, password: string) {
  return omegaFetch<{ token: string; expiresAt: string; user: OmegaUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function omegaLogout() {
  return omegaFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
}

export async function omegaMe() {
  return omegaFetch<OmegaUser>('/auth/me');
}

export const omegaApi = {
  dashboard: () => omegaFetch<OmegaDashboardSummary>('/admin/dashboard'),
  usage: () => omegaFetch<OmegaUsageOverview>('/admin/usage'),
  settings: () => omegaFetch<OmegaSettings>('/admin/settings'),
  clients: () => omegaFetch<OmegaClient[]>('/clients'),
  client: (id: string) => omegaFetch<OmegaClientDetails>(`/clients/${id}`),
  createClient: (payload: Partial<OmegaClient>) =>
    omegaFetch<OmegaClientDetails>('/clients', { method: 'POST', body: JSON.stringify(payload) }),
  updateClient: (id: string, payload: Partial<OmegaClient>) =>
    omegaFetch<OmegaClientDetails>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  plans: () => omegaFetch<OmegaPlan[]>('/plans'),
  createPlan: (payload: Partial<OmegaPlan>) =>
    omegaFetch<OmegaPlan>('/plans', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlan: (id: string, payload: Partial<OmegaPlan>) =>
    omegaFetch<OmegaPlan>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  sessions: () => omegaFetch<OmegaSession[]>('/sessions'),
  assignSession: (payload: { sessionId: string; clientId?: string | null }) =>
    omegaFetch<OmegaSession>('/sessions/assign', { method: 'POST', body: JSON.stringify(payload) }),
  syncMockSessions: () => omegaFetch<OmegaSession[]>('/sessions/mock-sync', { method: 'POST' }),
  users: () => omegaFetch<OmegaUser[]>('/users'),
  createUser: (payload: Record<string, unknown>) =>
    omegaFetch<OmegaUser>('/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Record<string, unknown>) =>
    omegaFetch<OmegaUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
};
