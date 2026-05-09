<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { formatDate } from '$lib/utils/date';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { i18n } from '$lib/i18n/index.svelte';

	interface DashboardStats {
		totalProjects: number;
		totalBackups: number;
		totalSizeBytes: number;
		recentBackups: Backup[];
		failedCount: number;
		nextScheduled: string | null;
	}

	interface Backup {
		id: number;
		project_name: string;
		project_id: number;
		type: string;
		status: string;
		started_at: string;
		completed_at: string | null;
		size_bytes: number;
		file_path: string | null;
	}

	let stats: DashboardStats | null = $state(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			stats = await api.get<DashboardStats>('/dashboard/stats');
		} catch {
			stats = null;
		} finally {
			loading = false;
		}
	});

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function formatDuration(backup: Backup): string {
		if (!backup.started_at || !backup.completed_at) return '-';
		const s = backup.started_at.endsWith('Z') ? backup.started_at : backup.started_at + 'Z';
		const e = backup.completed_at.endsWith('Z') ? backup.completed_at : backup.completed_at + 'Z';
		const ms = new Date(e).getTime() - new Date(s).getTime();
		if (ms < 0) return '-';
		const totalSec = Math.floor(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const sec = totalSec % 60;
		if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(sec).padStart(2, '0')}s`;
		if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`;
		return `${sec}s`;
	}

	function backupName(backup: Backup): string {
		if (backup.file_path) {
			const parts = backup.file_path.replace(/\\/g, '/').split('/');
			const name = parts[parts.length - 1] || `backup_${backup.id}`;
			return name.replace(/\.zip$/, '');
		}
		return `backup_${backup.id}`;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold text-white">{i18n.t('dashboard.title')}</h1>
	</div>

	{#if loading}
		<div class="flex justify-center py-20">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
		</div>
	{:else if stats}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
				<p class="text-sm text-surface-600">{i18n.t('dashboard.kpi.projects')}</p>
				<p class="mt-1 text-3xl font-bold text-white">{stats.totalProjects}</p>
			</div>
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
				<p class="text-sm text-surface-600">{i18n.t('dashboard.kpi.total_backups')}</p>
				<p class="mt-1 text-3xl font-bold text-white">{stats.totalBackups}</p>
			</div>
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
				<p class="text-sm text-surface-600">{i18n.t('dashboard.kpi.disk_usage')}</p>
				<p class="mt-1 text-3xl font-bold text-white">{formatBytes(stats.totalSizeBytes)}</p>
			</div>
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
				<p class="text-sm text-surface-600">{i18n.t('dashboard.kpi.recent_failures')}</p>
				<p class="mt-1 text-3xl font-bold" class:text-danger={stats.failedCount > 0} class:text-success={stats.failedCount === 0}>
					{stats.failedCount}
				</p>
			</div>
		</div>

		<div class="rounded-xl border border-surface-700 bg-surface-900">
			<div class="border-b border-surface-700 px-5 py-4">
				<h2 class="text-lg font-semibold text-white">{i18n.t('dashboard.recent_backups')}</h2>
			</div>
			{#if stats.recentBackups.length === 0}
				<div class="px-5 py-10 text-center text-surface-600">
					{i18n.t('dashboard.empty')}
				</div>
			{:else}
				<div class="divide-y divide-surface-800">
					{#each stats.recentBackups as backup}
						<a href="/projects/{backup.project_id}/backups/{backup.id}" class="flex items-center justify-between px-5 py-3 transition hover:bg-surface-800">
							<div class="flex items-center gap-3">
								<StatusBadge status={backup.status} />
								<div>
									<span class="font-medium text-white">{backup.project_name}</span>
									<span class="ml-2 font-mono text-sm text-surface-600">{backupName(backup)}</span>
								</div>
							</div>
							<div class="flex items-center gap-4 text-sm text-surface-600">
								<span>{formatDuration(backup)}</span>
								<span>{formatBytes(backup.size_bytes)}</span>
								<span>{formatDate(backup.started_at)}</span>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<div class="rounded-xl border border-surface-700 bg-surface-900 px-5 py-10 text-center text-surface-600">
			{i18n.t('dashboard.load_error')}
		</div>
	{/if}
</div>
