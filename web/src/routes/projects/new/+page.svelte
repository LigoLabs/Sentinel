<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import type { TranslationKey } from '$lib/i18n/dict';

	let name = $state('');
	let description = $state('');
	let cronDisposable = $state('0 3 * * *');
	let retentionCount = $state(15);
	let lifetimeEnabled = $state(true);
	let cronLifetime = $state('0 3 1 * *');
	let saving = $state(false);

	const disposablePresets: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.daily_3', value: '0 3 * * *' },
		{ key: 'project.new.cron.preset.daily_midnight', value: '0 0 * * *' },
		{ key: 'project.new.cron.preset.every_6h', value: '0 */6 * * *' },
		{ key: 'project.new.cron.preset.every_12h', value: '0 0,12 * * *' },
		{ key: 'project.new.cron.preset.weekly_sunday', value: '0 3 * * 0' },
		{ key: 'project.new.cron.preset.monthly_1st', value: '0 3 1 * *' },
	];

	const lifetimePresets: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.monthly_1st', value: '0 3 1 * *' },
		{ key: 'project.new.cron.preset.yearly', value: '0 3 1 1 *' },
	];

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!name.trim()) return;
		saving = true;

		try {
			const project = await api.post<{ id: number }>('/projects', {
				name: name.trim(),
				description,
				schedule: {
					cron_expression: cronDisposable,
					retention_count: retentionCount,
					retention_monthly: lifetimeEnabled,
					cron_lifetime: lifetimeEnabled ? cronLifetime : null,
				},
			});
			toast.success(i18n.t('project.new.created', { name }));
			goto(`/projects/${project.id}`);
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-2xl space-y-6">
	<div class="flex items-center gap-3">
		<a href="/projects" class="text-surface-600 hover:text-white" aria-label={i18n.t('common.cancel')}>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
		</a>
		<h1 class="text-2xl font-bold text-white">{i18n.t('project.new.title')}</h1>
	</div>

	<form onsubmit={handleSubmit} class="space-y-6 rounded-xl border border-surface-700 bg-surface-900 p-6">
		<div>
			<label for="name" class="mb-1 block text-sm font-medium text-slate-300">{i18n.t('project.new.name')}</label>
			<input
				id="name"
				type="text"
				bind:value={name}
				class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-white placeholder-surface-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
				placeholder={i18n.t('project.new.name_placeholder')}
				required
			/>
		</div>

		<div>
			<label for="desc" class="mb-1 block text-sm font-medium text-slate-300">{i18n.t('project.new.description')}</label>
			<textarea
				id="desc"
				bind:value={description}
				rows="2"
				class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-white placeholder-surface-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
				placeholder={i18n.t('project.new.description_placeholder')}
			></textarea>
		</div>

		<hr class="border-surface-700" />

		<h3 class="text-lg font-semibold text-white">{i18n.t('project.new.section.schedule')}</h3>

		<!-- Disposable backups (retention in days) -->
		<div class="rounded-lg border border-surface-700 bg-surface-800/40 p-4 space-y-3">
			<div>
				<h4 class="text-sm font-semibold text-slate-200">{i18n.t('project.new.disposable.title')}</h4>
				<p class="mt-0.5 text-xs text-surface-600">{i18n.t('project.new.disposable.help')}</p>
			</div>
			<div>
				<label for="cron_disp" class="mb-1 block text-xs text-surface-600">{i18n.t('project.new.disposable.cron')}</label>
				<input
					id="cron_disp"
					type="text"
					bind:value={cronDisposable}
					class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
				/>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each disposablePresets as preset}
						<button
							type="button"
							onclick={() => cronDisposable = preset.value}
							class="rounded-md px-2 py-1 text-xs transition {cronDisposable === preset.value ? 'bg-accent text-white' : 'bg-surface-800 text-surface-600 hover:bg-surface-700'}"
						>
							{i18n.t(preset.key)}
						</button>
					{/each}
				</div>
			</div>
			<div>
				<label for="retention" class="mb-1 block text-xs text-surface-600">{i18n.t('project.new.disposable.retention')}</label>
				<div class="flex items-center gap-2">
					<input
						id="retention"
						type="number"
						bind:value={retentionCount}
						min="1"
						max="999"
						class="w-24 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					/>
					<span class="text-sm text-surface-600">{i18n.t('project.new.disposable.retention_unit')}</span>
				</div>
			</div>
		</div>

		<!-- Lifetime snapshots (never deleted) -->
		<div class="rounded-lg border border-surface-700 bg-surface-800/40 p-4 space-y-3">
			<div>
				<h4 class="text-sm font-semibold text-slate-200">{i18n.t('project.new.lifetime.title')}</h4>
				<p class="mt-0.5 text-xs text-surface-600">{i18n.t('project.new.lifetime.help')}</p>
			</div>
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" bind:checked={lifetimeEnabled} class="h-4 w-4 rounded accent-accent" />
				<span class="text-sm text-slate-300">{i18n.t('project.new.lifetime.enable')}</span>
			</label>
			{#if lifetimeEnabled}
				<div>
					<label for="cron_life" class="mb-1 block text-xs text-surface-600">{i18n.t('project.new.lifetime.cron')}</label>
					<input
						id="cron_life"
						type="text"
						bind:value={cronLifetime}
						class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					/>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each lifetimePresets as preset}
							<button
								type="button"
								onclick={() => cronLifetime = preset.value}
								class="rounded-md px-2 py-1 text-xs transition {cronLifetime === preset.value ? 'bg-accent text-white' : 'bg-surface-800 text-surface-600 hover:bg-surface-700'}"
							>
								{i18n.t(preset.key)}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<div class="flex justify-end gap-3">
			<a href="/projects" class="rounded-lg border border-surface-700 px-4 py-2 text-sm text-surface-600 transition hover:bg-surface-800">
				{i18n.t('common.cancel')}
			</a>
			<button
				type="submit"
				disabled={saving}
				class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
			>
				{saving ? i18n.t('project.new.submitting') : i18n.t('project.new.submit')}
			</button>
		</div>
	</form>

	<p class="text-sm text-surface-600">
		{i18n.t('project.new.help_after')}
	</p>
</div>
