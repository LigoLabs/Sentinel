<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateFull } from '$lib/utils/date';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';

	interface SourceMeta {
		id: number;
		label: string;
		type: string;
		status: string;
		tables?: { name: string; rowCount: number }[];
		files?: number;
		sizeBytes?: number;
		error?: string;
	}

	interface BackupDetail {
		id: number;
		project_id: number;
		project_name: string;
		type: string;
		status: string;
		started_at: string;
		completed_at: string | null;
		size_bytes: number;
		file_path: string | null;
		error_message: string | null;
		metadata: {
			sources?: SourceMeta[];
			logs?: string[];
			duration?: number;
		};
	}

	interface ProgressData {
		phase: string;
		sourceLabel?: string;
		totalFiles?: number;
		downloadedFiles?: number;
		currentFile?: string;
		downloadedBytes?: number;
		message?: string;
		status?: string;
		duration?: number;
		backupId?: number;
	}

	let backup = $state<BackupDetail | null>(null);
	let loading = $state(true);
	let restoring = $state(false);
	let showLogs = $state(false);
	let progress = $state<ProgressData | null>(null);
	let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);

	const projectId = $derived($page.params.id);
	const backupId = $derived($page.params.backupId);

	function isRunning(b: BackupDetail): boolean {
		return b.status === 'running' || (!b.completed_at && b.status !== 'success' && b.status !== 'failed' && b.status !== 'partial');
	}

	function localizeStatus(status: string | undefined): string {
		if (status === 'success') return i18n.t('project.progress.status.success');
		if (status === 'partial') return i18n.t('project.progress.status.partial');
		return i18n.t('project.progress.status.failed');
	}

	function startPolling() {
		if (pollTimer) return;
		pollTimer = setInterval(async () => {
			try {
				const p = await api.get<ProgressData>(`/backups/progress/${backup?.project_id || projectId}`);
				if (p.phase === 'done' || p.phase === 'idle') {
					progress = null;
					stopPolling();
					backup = await api.get<BackupDetail>(`/backups/${backupId}`);
					if (p.phase === 'done') {
						toast.success(i18n.t('project.progress.toast', {
							status: localizeStatus(p.status),
							duration: Math.round((p.duration || 0) / 1000),
						}));
					}
				} else {
					progress = p;
				}
			} catch { /* ignore */ }
		}, 800);
	}

	function stopPolling() {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	}

	onMount(async () => {
		try {
			backup = await api.get<BackupDetail>(`/backups/${backupId}`);
			if (backup && isRunning(backup)) {
				startPolling();
			}
		} finally {
			loading = false;
		}
	});

	onDestroy(stopPolling);

	async function downloadBackup() {
		window.open(`/api/backups/${backupId}/download`, '_blank');
	}

	async function restoreBackup() {
		if (!confirm(i18n.t('backup.confirm.restore.first'))) return;
		if (!confirm(i18n.t('backup.confirm.restore.second'))) return;

		restoring = true;
		try {
			const result = await api.post<{ success: boolean; logs: string[] }>(`/backups/${backupId}/restore`);
			if (result.success) {
				toast.success(i18n.t('backup.restore.success'));
			} else {
				toast.error(i18n.t('backup.restore.partial'));
			}
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			restoring = false;
		}
	}

	async function deleteBackup() {
		if (!confirm(i18n.t('backup.confirm.delete'))) return;
		try {
			await api.delete(`/backups/${backupId}`);
			toast.success(i18n.t('backup.delete.success'));
			goto(`/projects/${projectId}`);
		} catch (err) {
			toast.error(translateError(err));
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function formatDuration(ms: number): string {
		const totalSec = Math.round(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `${pad(h)}:${pad(m)}:${pad(s)}`;
	}

	function backupDisplayName(b: BackupDetail): string {
		if (b.file_path) {
			const parts = b.file_path.replace(/\\/g, '/').split('/');
			const name = parts[parts.length - 1] || '';
			if (name) return name.replace(/\.zip$/, '');
		}
		return `Backup #${b.id}`;
	}
</script>

{#if loading}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if backup}
	<div class="space-y-6">
		<div class="flex items-center gap-3">
			<a href="/projects/{projectId}" class="text-surface-600 hover:text-white">
				<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
			</a>
			<h1 class="text-2xl font-bold text-white">{backupDisplayName(backup)}</h1>
			<StatusBadge status={backup.status} />
		</div>

		{#if progress && progress.phase !== 'idle'}
			<div class="rounded-xl border border-accent/30 bg-surface-900 p-5 space-y-3">
				<div class="flex items-center gap-3">
					<div class="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
					<span class="text-sm font-medium text-white">{progress.message || i18n.t('project.progress.default')}</span>
				</div>

				{#if progress.sourceLabel}
					<p class="text-xs text-surface-600">
						{i18n.t('project.progress.source_label')} <span class="text-slate-300">{progress.sourceLabel}</span>
					</p>
				{/if}

				{#if progress.phase === 'storage' && progress.totalFiles && progress.totalFiles > 0}
					{@const pct = Math.round((progress.downloadedFiles || 0) / progress.totalFiles * 100)}
					<div class="space-y-1.5">
						<div class="flex justify-between text-xs text-surface-600">
							<span>{i18n.t('project.progress.files_progress', { done: progress.downloadedFiles || 0, total: progress.totalFiles })}</span>
							<span>{pct}%{progress.downloadedBytes ? ` — ${formatBytes(progress.downloadedBytes)}` : ''}</span>
						</div>
						<div class="h-2.5 w-full overflow-hidden rounded-full bg-surface-800">
							<div
								class="h-full rounded-full bg-accent transition-all duration-300 ease-out"
								style="width: {pct}%"
							></div>
						</div>
						{#if progress.currentFile}
							<p class="truncate text-xs text-surface-600" title={progress.currentFile}>
								{progress.currentFile}
							</p>
						{/if}
					</div>
			{:else if progress.phase === 'storage'}
				<div class="space-y-1.5">
					<p class="text-xs text-surface-600">
						{progress.currentFile || i18n.t('project.progress.files_scanning')}
					</p>
					<div class="h-2.5 w-full overflow-hidden rounded-full bg-surface-800">
						<div class="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-accent/60"></div>
					</div>
				</div>
				{:else if progress.phase === 'database'}
					<div class="space-y-1.5">
						<p class="text-xs text-surface-600">{i18n.t('project.progress.dumping')}</p>
						<div class="h-2.5 w-full overflow-hidden rounded-full bg-surface-800">
							<div class="h-full w-full animate-pulse rounded-full bg-accent/50"></div>
						</div>
					</div>
				{:else if progress.phase === 'compressing'}
					<div class="space-y-1.5">
						<p class="text-xs text-surface-600">{i18n.t('project.progress.compressing')}</p>
						<div class="h-2.5 w-full overflow-hidden rounded-full bg-surface-800">
							<div class="h-full w-full animate-pulse rounded-full bg-warning/50"></div>
						</div>
					</div>
				{/if}
			</div>
		{:else if isRunning(backup)}
			<div class="rounded-xl border border-accent/30 bg-surface-900 p-5">
				<div class="flex items-center gap-3">
					<div class="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
					<span class="text-sm font-medium text-white">{i18n.t('backup.running')}</span>
				</div>
			</div>
		{/if}

		<!-- Info cards -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-4">
				<p class="text-xs text-surface-600">{i18n.t('backup.info.project')}</p>
				<p class="mt-1 font-medium text-white">{backup.project_name}</p>
			</div>
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-4">
				<p class="text-xs text-surface-600">{i18n.t('backup.info.type')}</p>
				<p class="mt-1 font-medium text-white capitalize">{backup.type}</p>
			</div>
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-4">
				<p class="text-xs text-surface-600">{i18n.t('backup.info.size')}</p>
				<p class="mt-1 font-medium text-white">{formatBytes(backup.size_bytes)}</p>
			</div>
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-4">
				<p class="text-xs text-surface-600">{i18n.t('backup.info.duration')}</p>
				<p class="mt-1 font-medium text-white">{backup.metadata?.duration ? formatDuration(backup.metadata.duration) : '-'}</p>
			</div>
		</div>

		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<div class="flex gap-6 text-sm">
				<div>
					<span class="text-surface-600">{i18n.t('backup.info.started')}</span>
					<span class="ml-1 text-white">{formatDateFull(backup.started_at)}</span>
				</div>
			{#if backup.completed_at}
				<div>
					<span class="text-surface-600">{i18n.t('backup.info.finished')}</span>
					<span class="ml-1 text-white">{formatDateFull(backup.completed_at)}</span>
				</div>
			{/if}
			{#if backup.metadata?.duration}
				<div>
					<span class="text-surface-600">{i18n.t('backup.info.duration_label')}</span>
					<span class="ml-1 font-mono text-white">{formatDuration(backup.metadata.duration)}</span>
				</div>
			{/if}
			</div>

			{#if backup.error_message}
				<div class="mt-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
					{backup.error_message}
				</div>
			{/if}
		</div>

		<!-- Sources detail -->
		{#if backup.metadata?.sources && backup.metadata.sources.length > 0}
			<div class="rounded-xl border border-surface-700 bg-surface-900">
				<div class="border-b border-surface-700 px-5 py-4">
					<h2 class="text-lg font-semibold text-white">{i18n.t('backup.sources.title')}</h2>
				</div>
				<div class="divide-y divide-surface-800">
					{#each backup.metadata.sources as source}
						<div class="px-5 py-4">
							<div class="flex items-center gap-3">
								<StatusBadge status={source.status} />
								<span class="font-medium text-white">{source.label}</span>
								<span class="rounded-md bg-surface-800 px-2 py-0.5 text-xs text-surface-600">{source.type}</span>
							</div>

							{#if source.tables}
								<div class="mt-3 rounded-lg bg-surface-800 p-3">
									<table class="w-full text-sm">
										<thead>
											<tr class="text-left text-xs text-surface-600">
												<th class="pb-2">{i18n.t('backup.sources.table.col_name')}</th>
												<th class="pb-2 text-right">{i18n.t('backup.sources.table.col_rows')}</th>
											</tr>
										</thead>
										<tbody>
											{#each source.tables as table}
												<tr class="border-t border-surface-700">
													<td class="py-1.5 font-mono text-slate-300">{table.name}</td>
													<td class="py-1.5 text-right text-white">{table.rowCount.toLocaleString(i18n.locale())}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}

							{#if source.files !== undefined}
								<p class="mt-2 text-sm text-surface-600">
									{i18n.tn('backup.sources.files', source.files)}{source.sizeBytes ? i18n.t('backup.sources.files_size_suffix', { size: formatBytes(source.sizeBytes) }) : ''}
								</p>
							{/if}

							{#if source.error}
								<p class="mt-2 text-sm text-danger">{source.error}</p>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Logs -->
		{#if backup.metadata?.logs}
			<div class="rounded-xl border border-surface-700 bg-surface-900">
				<button onclick={() => showLogs = !showLogs} class="flex w-full items-center justify-between px-5 py-4 text-left">
					<h2 class="text-lg font-semibold text-white">{i18n.t('backup.logs.title')}</h2>
					<svg class="h-5 w-5 text-surface-600 transition {showLogs ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
				{#if showLogs}
					<div class="border-t border-surface-700 p-5">
						<pre class="max-h-96 overflow-auto rounded-lg bg-surface-950 p-4 font-mono text-xs text-slate-300">{backup.metadata.logs.join('\n')}</pre>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex gap-3">
			{#if !isRunning(backup)}
				<button onclick={downloadBackup} class="rounded-lg bg-surface-800 px-4 py-2 text-sm text-white transition hover:bg-surface-700">
					{i18n.t('backup.actions.download')}
				</button>
				<button onclick={restoreBackup} disabled={restoring} class="rounded-lg bg-warning/20 px-4 py-2 text-sm text-warning transition hover:bg-warning/30 disabled:opacity-50">
					{restoring ? i18n.t('backup.actions.restoring') : i18n.t('backup.actions.restore')}
				</button>
			{/if}
			<button onclick={deleteBackup} class="rounded-lg bg-danger/20 px-4 py-2 text-sm text-danger transition hover:bg-danger/30">
				{i18n.t('backup.actions.delete')}
			</button>
		</div>
	</div>
{:else}
	<div class="py-20 text-center text-surface-600">{i18n.t('backup.not_found')}</div>
{/if}

<style>
	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(400%); }
	}
</style>
