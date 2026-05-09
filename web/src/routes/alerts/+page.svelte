<script lang="ts">
	import { onMount } from 'svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { formatDate } from '$lib/utils/date';

	let loading = $state(true);

	onMount(async () => {
		await Promise.all([alerts.loadList(), alerts.refreshCount()]);
		loading = false;
	});

	function alertTypeLabel(type: string): string {
		if (type === 'failure') return i18n.t('alerts.type.failure');
		return type;
	}
</script>

<div class="space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-white">{i18n.t('alerts.title')}</h1>
			<p class="mt-1 text-sm text-surface-600">{i18n.t('alerts.subtitle')}</p>
		</div>
		{#if alerts.unreadCount > 0}
			<button
				onclick={() => alerts.markAllRead()}
				class="rounded-lg bg-surface-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-surface-700"
			>
				{i18n.t('alerts.mark_all_read')}
			</button>
		{/if}
	</div>

	{#if loading}
		<div class="flex justify-center py-20">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
		</div>
	{:else if alerts.items.length === 0}
		<div class="rounded-xl border border-surface-700 bg-surface-900 py-16 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
				<svg class="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			</div>
			<p class="text-surface-600">{i18n.t('alerts.empty')}</p>
		</div>
	{:else}
		<div class="rounded-xl border border-surface-700 bg-surface-900 divide-y divide-surface-800">
			{#each alerts.items as alert}
				<div
					class="flex items-start gap-4 p-5 transition {alert.is_read ? '' : 'bg-warning/5'}"
				>
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full {alert.is_read ? 'bg-surface-800 text-surface-600' : 'bg-danger/15 text-danger'}">
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="rounded-md bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
								{alertTypeLabel(alert.type)}
							</span>
							<span class="font-medium text-white">{alert.project_name}</span>
							{#if !alert.is_read}
								<span class="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
									{i18n.t('alerts.unread_badge')}
								</span>
							{/if}
						</div>

						<p class="mt-1 text-sm text-slate-300">{alert.message}</p>

						<div class="mt-2 flex flex-wrap items-center gap-4 text-xs text-surface-600">
							<span>{formatDate(alert.created_at)}</span>
							{#if alert.backup_id}
								<a href="/projects/{alert.project_id}/backups/{alert.backup_id}" class="text-accent hover:underline">
									{i18n.t('alerts.go_to_backup')}
								</a>
							{/if}
							<a href="/projects/{alert.project_id}" class="text-accent hover:underline">
								{i18n.t('alerts.go_to_project')}
							</a>
						</div>
					</div>

					<button
						onclick={() => alerts.toggleRead(alert.id)}
						class="shrink-0 rounded-md p-1.5 text-surface-500 transition hover:bg-surface-800 hover:text-white"
						aria-label={alert.is_read ? i18n.t('alerts.mark_unread') : i18n.t('alerts.mark_read')}
						title={alert.is_read ? i18n.t('alerts.mark_unread') : i18n.t('alerts.mark_read')}
					>
						{#if alert.is_read}
							<!-- envelope (will mark as unread) -->
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						{:else}
							<!-- check (will mark as read) -->
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
							</svg>
						{/if}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
