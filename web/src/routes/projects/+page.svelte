<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDate } from '$lib/utils/date';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';

	interface TmpStatus {
		count: number;
		totalSizeBytes: number;
	}

	interface ProjectListItem {
		id: number;
		name: string;
		description: string;
		is_active: number;
		sourcesCount: number;
		schedule: { cron_expression: string; is_active: number } | null;
		lastBackup: { id: number; status: string; started_at: string; size_bytes: number } | null;
	}

	let projects = $state<ProjectListItem[]>([]);
	let loading = $state(true);
	let tmp = $state<TmpStatus | null>(null);
	let cleaningTmp = $state(false);

	async function loadTmpStatus() {
		try { tmp = await api.get<TmpStatus>('/dashboard/tmp/status'); } catch { /* ignore */ }
	}

	onMount(async () => {
		try {
			projects = await api.get<ProjectListItem[]>('/projects');
		} finally {
			loading = false;
		}
		await loadTmpStatus();
	});

	async function cleanupTmp() {
		cleaningTmp = true;
		try {
			const result = await api.post<{ cleaned: number }>('/dashboard/tmp/cleanup');
			toast.success(i18n.t('projects.tmp.cleaned', { n: result.cleaned }));
			await loadTmpStatus();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			cleaningTmp = false;
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold text-white">{i18n.t('projects.title')}</h1>
		<a href="/projects/new" class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover">
			{i18n.t('projects.new')}
		</a>
	</div>

	{#if tmp && tmp.count > 0}
		<div class="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5">
			<div class="flex items-center gap-2 text-sm text-warning">
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<span>{i18n.tn('projects.tmp.warning', tmp.count)}</span>
				<span class="text-xs text-surface-600">({formatBytes(tmp.totalSizeBytes)})</span>
			</div>
			<button
				onclick={cleanupTmp}
				disabled={cleaningTmp}
				class="rounded-md bg-warning/20 px-3 py-1 text-xs font-medium text-warning transition hover:bg-warning/30 disabled:opacity-50"
			>
				{cleaningTmp ? i18n.t('projects.tmp.cleaning') : i18n.t('projects.tmp.cleanup')}
			</button>
		</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-20">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
		</div>
	{:else if projects.length === 0}
		<div class="rounded-xl border border-surface-700 bg-surface-900 py-16 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-800">
				<svg class="h-6 w-6 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
			</div>
			<p class="text-surface-600">{i18n.t('projects.empty.title')}</p>
			<a href="/projects/new" class="mt-3 inline-block text-sm text-accent hover:underline">{i18n.t('projects.empty.cta')}</a>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each projects as project}
				<a href="/projects/{project.id}" class="group rounded-xl border border-surface-700 bg-surface-900 p-5 transition hover:border-surface-600">
					<div class="flex items-start justify-between">
						<div>
							<h2 class="font-semibold text-white group-hover:text-accent">{project.name}</h2>
							{#if project.description}
								<p class="mt-1 text-sm text-surface-600 line-clamp-2">{project.description}</p>
							{/if}
						</div>
						<span class="rounded-full px-2 py-0.5 text-xs {project.is_active ? 'bg-success/15 text-success' : 'bg-surface-700 text-surface-600'}">
							{project.is_active ? i18n.t('projects.card.active') : i18n.t('projects.card.inactive')}
						</span>
					</div>

					<div class="mt-4 flex items-center gap-4 text-sm text-surface-600">
						<span>{i18n.tn('projects.card.sources', project.sourcesCount)}</span>
						{#if project.schedule}
							<span class="font-mono text-xs">{project.schedule.cron_expression}</span>
						{/if}
					</div>

					{#if project.lastBackup}
						<div class="mt-3 flex items-center justify-between border-t border-surface-800 pt-3">
							<StatusBadge status={project.lastBackup.status} />
							<span class="text-xs text-surface-600">{formatDate(project.lastBackup.started_at)}</span>
						</div>
					{:else}
						<div class="mt-3 border-t border-surface-800 pt-3 text-xs text-surface-600">
							{i18n.t('projects.card.no_backup')}
						</div>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>
