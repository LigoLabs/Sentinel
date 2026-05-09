import { browser } from '$app/environment';
import { api, ApiError } from '$lib/api';
import { auth } from './auth.svelte';

export interface Alert {
  id: number;
  project_id: number;
  project_name: string;
  backup_id: number | null;
  type: string;
  message: string;
  is_read: number;
  created_at: string;
}

const POLL_INTERVAL_MS = 30_000;

function createAlerts() {
  let unreadCount = $state(0);
  let items = $state<Alert[]>([]);
  let loaded = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshCount() {
    if (!auth.authenticated) return;
    try {
      const res = await api.get<{ count: number }>('/dashboard/alerts/count');
      unreadCount = res.count;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        unreadCount = 0;
      }
    }
  }

  async function loadList() {
    if (!auth.authenticated) return;
    try {
      items = await api.get<Alert[]>('/dashboard/alerts');
      loaded = true;
    } catch { /* ignore */ }
  }

  async function markRead(id: number) {
    try {
      await api.post(`/dashboard/alerts/${id}/read`);
      const target = items.find((a) => a.id === id);
      if (target && !target.is_read) {
        target.is_read = 1;
        unreadCount = Math.max(0, unreadCount - 1);
      }
    } catch { /* ignore */ }
  }

  async function markUnread(id: number) {
    try {
      await api.post(`/dashboard/alerts/${id}/unread`);
      const target = items.find((a) => a.id === id);
      if (target && target.is_read) {
        target.is_read = 0;
        unreadCount += 1;
      }
    } catch { /* ignore */ }
  }

  async function toggleRead(id: number) {
    const target = items.find((a) => a.id === id);
    if (!target) return;
    if (target.is_read) await markUnread(id);
    else await markRead(id);
  }

  async function markAllRead() {
    try {
      await api.post('/dashboard/alerts/read-all');
      for (const item of items) item.is_read = 1;
      unreadCount = 0;
    } catch { /* ignore */ }
  }

  function startPolling() {
    if (!browser || pollTimer) return;
    refreshCount();
    pollTimer = setInterval(refreshCount, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  return {
    get unreadCount() { return unreadCount; },
    get items() { return items; },
    get loaded() { return loaded; },
    refreshCount,
    loadList,
    markRead,
    markUnread,
    toggleRead,
    markAllRead,
    startPolling,
    stopPolling,
  };
}

export const alerts = createAlerts();
