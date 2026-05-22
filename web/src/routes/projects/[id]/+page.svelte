<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDate } from '$lib/utils/date';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import SourceForm from '$lib/components/SourceForm.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import { alerts } from '$lib/stores/alerts.svelte';
	import type { TranslationKey } from '$lib/i18n/dict';

	interface Source {
		id: number;
		type: string;
		label: string;
		hasConfig: boolean;
	}

	interface Backup {
		id: number;
		type: string;
		status: string;
		started_at: string;
		completed_at: string | null;
		size_bytes: number;
		file_path: string | null;
	}

	interface Schedule {
		cron_expression: string;
		retention_count: number;
		retention_monthly: number;
		cron_lifetime: string | null;
		is_active: number;
	}

	interface ProjectDetail {
		id: number;
		name: string;
		description: string;
		is_active: number;
		totalSizeBytes: number;
		schedule: Schedule | null;
		sources: Source[];
		backups: Backup[];
	}

	interface EditSourceData {
		id: number;
		type: string;
		label: string;
		config: Record<string, unknown>;
	}

	interface BackupProgressData {
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

	let project = $state<ProjectDetail | null>(null);
	let loading = $state(true);
	let triggerLoading = $state(false);
	let showSourceForm = $state(false);
	let editingSchedule = $state(false);
	let editingSource = $state<EditSourceData | undefined>(undefined);
	let loadingSourceId = $state<number | null>(null);
	let progress = $state<BackupProgressData | null>(null);
	let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);

	let editCron = $state('');
	let editRetCount = $state(15);
	let editLifetimeEnabled = $state(true);
	let editCronLifetime = $state('0 3 1 * *');
	let showDeleteConfirm = $state(false);
	let deleteLoading = $state(false);

	const projectId = $derived(Number($page.params.id));

	async function loadProject() {
		try {
			project = await api.get<ProjectDetail>(`/projects/${projectId}`);
			if (project?.schedule) {
				editCron = project.schedule.cron_expression;
				editRetCount = project.schedule.retention_count;
				const cl = project.schedule.cron_lifetime;
				editLifetimeEnabled = !!(cl && cl.trim());
				editCronLifetime = cl?.trim() || '0 3 1 * *';
			}
		} finally {
			loading = false;
		}
	}

	onMount(loadProject);
	onDestroy(stopPolling);

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const s = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
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
				const p = await api.get<BackupProgressData>(`/backups/progress/${projectId}`);
				progress = p;
				if (p.phase === 'done' || p.phase === 'idle') {
					stopPolling();
					if (p.phase === 'done') {
						triggerLoading = false;
						toast.success(i18n.t('project.progress.toast', {
							status: localizeStatus(p.status),
							duration: Math.round((p.duration || 0) / 1000),
						}));
						progress = null;
						await loadProject();
						alerts.refreshCount();
					}
				}
			} catch { /* ignore */ }
		}, 800);
	}

	function stopPolling() {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	}

	async function triggerBackup() {
		triggerLoading = true;
		progress = { phase: 'starting', message: i18n.t('project.progress.starting') };
		try {
			await api.post('/backups/trigger', { project_id: projectId });
			startPolling();
		} catch (err) {
			toast.error(translateError(err));
			triggerLoading = false;
			progress = null;
		}
	}

	async function saveSchedule() {
		try {
			await api.put(`/projects/${projectId}`, {
				schedule: {
					cron_expression: editCron,
					retention_count: editRetCount,
					retention_monthly: editLifetimeEnabled,
					cron_lifetime: editLifetimeEnabled ? editCronLifetime : null,
				},
			});
			toast.success(i18n.t('project.schedule.saved'));
			editingSchedule = false;
			await loadProject();
		} catch (err) {
			toast.error(translateError(err));
		}
	}

	async function editSource(sourceId: number) {
		loadingSourceId = sourceId;
		try {
			const source = await api.get<EditSourceData>(`/sources/${sourceId}`);
			editingSource = source;
			showSourceForm = true;
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			loadingSourceId = null;
		}
	}

	async function deleteSource(sourceId: number) {
		if (!confirm(i18n.t('project.sources.delete_confirm'))) return;
		try {
			await api.delete(`/sources/${sourceId}`);
			toast.success(i18n.t('project.sources.deleted'));
			await loadProject();
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

	function backupName(backup: Backup): string {
		if (backup.file_path) {
			const parts = backup.file_path.replace(/\\/g, '/').split('/');
			const name = parts[parts.length - 1] || `backup_${backup.id}`;
			return name.replace(/\.zip$/, '');
		}
		return `backup_${backup.id}`;
	}

	async function deleteProject() {
		deleteLoading = true;
		try {
			await api.delete(`/projects/${projectId}`);
			toast.success(i18n.t('project.danger.deleted'));
			goto('/projects');
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			deleteLoading = false;
			showDeleteConfirm = false;
		}
	}

	function sourceTypeLabel(type: string): string {
		const key = `source.type.${type}` as TranslationKey;
		const translated = i18n.t(key);
		return translated === key ? type : translated;
	}
</script>

{#if loading}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if project}
	<div class="space-y-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<a href="/projects" class="text-surface-600 hover:text-white">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
					</svg>
				</a>
				<h1 class="text-2xl font-bold text-white">{project.name}</h1>
				<span class="rounded-full px-2 py-0.5 text-xs {project.is_active ? 'bg-success/15 text-success' : 'bg-surface-700 text-surface-600'}">
					{project.is_active ? i18n.t('projects.card.active') : i18n.t('projects.card.inactive')}
				</span>
				{#if project.backups.length > 0}
					<span
						class="rounded-full bg-surface-800 px-2.5 py-0.5 font-mono text-xs text-slate-300"
						title={i18n.t('project.history.total_disk', { size: formatBytes(project.totalSizeBytes), count: project.backups.length })}
					>
						{formatBytes(project.totalSizeBytes)}
					</span>
				{/if}
			</div>
			<button
				onclick={triggerBackup}
				disabled={triggerLoading}
				class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
			>
				{triggerLoading ? i18n.t('project.run_backup.running') : i18n.t('project.run_backup')}
			</button>
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
						<span>{pct}%{progress.downloadedBytes ? ` — ${formatSize(progress.downloadedBytes)}` : ''}</span>
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-surface-800">
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
					<div class="h-2 w-full overflow-hidden rounded-full bg-surface-800">
						<div class="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-accent/60"></div>
					</div>
				</div>
			{:else if progress.phase === 'database'}
				<div class="space-y-1.5">
					<p class="text-xs text-surface-600">{i18n.t('project.progress.dumping')}</p>
					<div class="h-2 w-full overflow-hidden rounded-full bg-surface-800">
						<div class="h-full w-full animate-pulse rounded-full bg-accent/50"></div>
					</div>
				</div>
			{:else if progress.phase === 'compressing'}
				<div class="space-y-1.5">
					<p class="text-xs text-surface-600">{i18n.t('project.progress.compressing')}</p>
					<div class="h-2 w-full overflow-hidden rounded-full bg-surface-800">
						<div class="h-full w-full animate-pulse rounded-full bg-warning/50"></div>
					</div>
				</div>
			{/if}
			</div>
		{/if}

		{#if project.description}
			<p class="text-surface-600">{project.description}</p>
		{/if}

		<!-- Schedule -->
		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<div class="flex items-center justify-between">
				<h2 class="text-lg font-semibold text-white">{i18n.t('project.schedule.title')}</h2>
				<button onclick={() => editingSchedule = !editingSchedule} class="text-sm text-accent hover:underline">
					{editingSchedule ? i18n.t('project.schedule.cancel') : i18n.t('project.schedule.edit')}
				</button>
			</div>
			{#if editingSchedule}
				<div class="mt-4 space-y-4">
					<!-- Disposable -->
					<div class="rounded-lg border border-surface-700 bg-surface-800/40 p-3 space-y-2">
						<h4 class="text-sm font-semibold text-slate-200">{i18n.t('project.schedule.disposable.title')}</h4>
						<div>
							<label class="mb-1 block text-xs text-surface-600">{i18n.t('project.schedule.disposable.cron')}</label>
							<input bind:value={editCron} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
						</div>
						<div>
							<label class="mb-1 block text-xs text-surface-600">{i18n.t('project.schedule.disposable.retention')}</label>
							<div class="flex items-center gap-2">
								<input type="number" bind:value={editRetCount} min="1" max="999" class="w-24 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-white focus:border-accent focus:outline-none" />
								<span class="text-sm text-surface-600">{i18n.t('project.schedule.disposable.retention_unit')}</span>
							</div>
						</div>
					</div>
					<!-- Lifetime -->
					<div class="rounded-lg border border-surface-700 bg-surface-800/40 p-3 space-y-2">
						<h4 class="text-sm font-semibold text-slate-200">{i18n.t('project.schedule.lifetime.title')}</h4>
						<label class="flex items-center gap-2 cursor-pointer">
							<input type="checkbox" bind:checked={editLifetimeEnabled} class="h-4 w-4 rounded accent-accent" />
							<span class="text-sm text-slate-300">{i18n.t('project.schedule.lifetime.enable')}</span>
						</label>
						{#if editLifetimeEnabled}
							<div>
								<label class="mb-1 block text-xs text-surface-600">{i18n.t('project.schedule.lifetime.cron')}</label>
								<input bind:value={editCronLifetime} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
							</div>
						{/if}
					</div>
					<button onclick={saveSchedule} class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
						{i18n.t('project.schedule.save')}
					</button>
				</div>
			{:else if project.schedule}
				<div class="mt-3 space-y-1 text-sm">
					<div>
						<span class="text-surface-600">{i18n.t('project.schedule.summary.disposable')}</span>
						<span class="ml-1 text-white">{i18n.t('project.schedule.summary.disposable_value', { cron: project.schedule.cron_expression, n: project.schedule.retention_count })}</span>
					</div>
					<div>
						<span class="text-surface-600">{i18n.t('project.schedule.summary.lifetime')}</span>
						{#if project.schedule.cron_lifetime}
							<span class="ml-1 text-white">{i18n.t('project.schedule.summary.lifetime_value', { cron: project.schedule.cron_lifetime })}</span>
						{:else}
							<span class="ml-1 text-surface-600">{i18n.t('project.schedule.summary.lifetime_off')}</span>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Sources -->
		<div class="rounded-xl border border-surface-700 bg-surface-900">
			<div class="flex items-center justify-between border-b border-surface-700 px-5 py-4">
				<h2 class="text-lg font-semibold text-white">{i18n.t('project.sources.title')}</h2>
				<button onclick={() => { showSourceForm = !showSourceForm; editingSource = undefined; }} class="rounded-lg bg-surface-800 px-3 py-1.5 text-sm text-accent hover:bg-surface-700">
					{showSourceForm ? i18n.t('project.sources.cancel') : i18n.t('project.sources.add')}
				</button>
			</div>

			{#if showSourceForm}
				<div class="border-b border-surface-700 p-5">
					{#key editingSource?.id}
						<SourceForm
							projectId={projectId}
							editSource={editingSource}
							onCreated={() => { showSourceForm = false; editingSource = undefined; loadProject(); }}
						/>
					{/key}
				</div>
			{/if}

			{#if project.sources.length === 0}
				<div class="px-5 py-8 text-center text-surface-600">
					{i18n.t('project.sources.empty')}
				</div>
			{:else}
				<div class="divide-y divide-surface-800">
					{#each project.sources as source}
						<div class="flex items-center justify-between px-5 py-3">
							<div class="flex items-center gap-3">
								<span class="rounded-md bg-surface-800 px-2 py-1 text-xs font-medium text-surface-600">
									{source.type}
								</span>
								<span class="text-white">{source.label}</span>
								<span class="text-xs text-surface-600">{sourceTypeLabel(source.type)}</span>
							</div>
							<div class="flex items-center gap-3">
								<button
									onclick={() => editSource(source.id)}
									disabled={loadingSourceId === source.id}
									class="text-xs text-accent hover:underline disabled:opacity-50"
								>
									{loadingSourceId === source.id ? i18n.t('project.sources.edit_loading') : i18n.t('project.sources.edit')}
								</button>
								<button onclick={() => deleteSource(source.id)} class="text-xs text-danger hover:underline">
									{i18n.t('project.sources.delete')}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Backups history -->
		<div class="rounded-xl border border-surface-700 bg-surface-900">
			<div class="flex items-center justify-between border-b border-surface-700 px-5 py-4">
				<h2 class="text-lg font-semibold text-white">{i18n.t('project.history.title')}</h2>
				{#if project.backups.length > 0}
					<span class="text-xs text-surface-600">
						{i18n.t('project.history.total_disk', { size: formatBytes(project.totalSizeBytes), count: project.backups.length })}
					</span>
				{/if}
			</div>

			{#if project.backups.length === 0}
				<div class="px-5 py-8 text-center text-surface-600">{i18n.t('project.history.empty')}</div>
			{:else}
				<div class="divide-y divide-surface-800">
					{#each project.backups as backup}
						<a href="/projects/{projectId}/backups/{backup.id}" class="flex items-center justify-between px-5 py-3 transition hover:bg-surface-800">
							<div class="flex items-center gap-3">
								<StatusBadge status={backup.status} />
								<span class="font-mono text-sm text-white">{backupName(backup)}</span>
								<span class="text-xs text-surface-600">{backup.type}</span>
							</div>
							<div class="flex items-center gap-4 text-sm text-surface-600">
								<span>{formatBytes(backup.size_bytes)}</span>
								<span>{formatDate(backup.started_at)}</span>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
		<!-- Danger zone -->
		<div class="rounded-xl border border-danger/30 bg-surface-900 p-5">
			<h2 class="text-lg font-semibold text-danger">{i18n.t('project.danger.title')}</h2>
			<p class="mt-2 text-sm text-surface-600">
				{i18n.t('project.danger.description')}
			</p>
			<button
				onclick={() => showDeleteConfirm = true}
				class="mt-4 rounded-lg border border-danger/50 bg-danger/10 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/20"
			>
				{i18n.t('project.danger.delete')}
			</button>
		</div>
	</div>

	{#if showDeleteConfirm}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div class="w-full max-w-md rounded-xl border border-surface-700 bg-surface-900 p-6 shadow-2xl">
				<h3 class="text-lg font-bold text-white">{i18n.t('project.danger.confirm.title')}</h3>
				<p class="mt-3 text-sm text-surface-600">
					{@html i18n.t('project.danger.confirm.intro', { name: `<strong class="text-white">${project.name}</strong>` })}
				</p>
				<ul class="mt-2 space-y-1 text-sm text-surface-600">
					<li>{i18n.tn('project.danger.confirm.backups', project.backups.length)}</li>
					<li>{i18n.tn('project.danger.confirm.sources', project.sources.length)}</li>
					<li>{i18n.t('project.danger.confirm.schedule')}</li>
				</ul>
				<p class="mt-3 text-sm font-medium text-danger">{i18n.t('project.danger.confirm.warning')}</p>
				<div class="mt-5 flex justify-end gap-3">
					<button
						onclick={() => showDeleteConfirm = false}
						class="rounded-lg bg-surface-800 px-4 py-2 text-sm text-white hover:bg-surface-700"
					>
						{i18n.t('project.danger.confirm.cancel')}
					</button>
					<button
						onclick={deleteProject}
						disabled={deleteLoading}
						class="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:bg-danger/80 disabled:opacity-50"
					>
						{deleteLoading ? i18n.t('project.danger.confirm.submitting') : i18n.t('project.danger.confirm.submit')}
					</button>
				</div>
			</div>
		</div>
	{/if}
{:else}
	<div class="py-20 text-center text-surface-600">{i18n.t('project.not_found')}</div>
{/if}

<style>
	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(400%); }
	}
</style>
