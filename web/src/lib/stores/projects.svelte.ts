import { api, ApiError } from '$lib/api';
import { auth } from './auth.svelte';

export interface ProjectListItem {
  id: number;
  name: string;
  description: string;
  is_active: number;
  sourcesCount: number;
  totalSizeBytes: number;
  schedule: { cron_expression: string; is_active: number } | null;
  lastBackup: { id: number; status: string; started_at: string; size_bytes: number } | null;
}

function createProjects() {
  let items = $state<ProjectListItem[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let lastFetch = 0;
  const CACHE_MS = 10_000;

  async function load(force = false) {
    if (!auth.authenticated) return;
    if (loading) return;
    if (!force && loaded && Date.now() - lastFetch < CACHE_MS) return;
    loading = true;
    try {
      items = await api.get<ProjectListItem[]>('/projects');
      loaded = true;
      lastFetch = Date.now();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        items = [];
        loaded = false;
      }
    } finally {
      loading = false;
    }
  }

  function invalidate() {
    loaded = false;
    lastFetch = 0;
  }

  return {
    get items() { return items; },
    get loaded() { return loaded; },
    get loading() { return loading; },
    load,
    invalidate,
  };
}

export const projectsStore = createProjects();
