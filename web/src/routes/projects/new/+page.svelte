<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import type { TranslationKey } from '$lib/i18n/dict';

	let name = $state('');
	let description = $state('');
	let cronExpression = $state('0 3 * * *');
	let retentionDays = $state(15);
	let retentionMonthly = $state(true);
	let saving = $state(false);

	const cronPresets: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.daily_3', value: '0 3 * * *' },
		{ key: 'project.new.cron.preset.daily_midnight', value: '0 0 * * *' },
		{ key: 'project.new.cron.preset.every_6h', value: '0 */6 * * *' },
		{ key: 'project.new.cron.preset.every_12h', value: '0 0,12 * * *' },
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
					cron_expression: cronExpression,
					retention_daily_days: retentionDays,
					retention_monthly: retentionMonthly,
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
		<a href="/projects" class="text-surface-600 hover:text-white">
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

		<div>
			<label for="cron" class="mb-1 block text-sm font-medium text-slate-300">{i18n.t('project.new.cron')}</label>
			<p class="mb-2 text-xs text-surface-600">{i18n.t('project.new.cron_help')}</p>
			<div class="flex gap-2">
				<input
					id="cron"
					type="text"
					bind:value={cronExpression}
					class="flex-1 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
				/>
			</div>
			<div class="mt-2 flex flex-wrap gap-2">
				{#each cronPresets as preset}
					<button
						type="button"
						onclick={() => cronExpression = preset.value}
						class="rounded-md px-2 py-1 text-xs transition {cronExpression === preset.value ? 'bg-accent text-white' : 'bg-surface-800 text-surface-600 hover:bg-surface-700'}"
					>
						{i18n.t(preset.key)}
					</button>
				{/each}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div>
				<label for="retention" class="mb-1 block text-sm font-medium text-slate-300">{i18n.t('project.new.retention_daily')}</label>
				<div class="flex items-center gap-2">
					<input
						id="retention"
						type="number"
						bind:value={retentionDays}
						min="1"
						max="365"
						class="w-20 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-white focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					/>
					<span class="text-sm text-surface-600">{i18n.t('project.new.retention_daily_unit')}</span>
				</div>
			</div>

			<div>
				<label class="mb-1 block text-sm font-medium text-slate-300">{i18n.t('project.new.retention_monthly')}</label>
				<label class="mt-2 flex items-center gap-2">
					<input type="checkbox" bind:checked={retentionMonthly} class="h-4 w-4 rounded border-surface-700 bg-surface-800 text-accent focus:ring-accent" />
					<span class="text-sm text-slate-300">{i18n.t('project.new.retention_monthly_check')}</span>
				</label>
			</div>
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
