<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import type { TranslationKey } from '$lib/i18n/dict';

	interface DashboardStats {
		totalProjects: number;
		totalBackups: number;
		totalSizeBytes: number;
		failedCount: number;
		activeSchedules: number;
	}

	interface TmpStatus {
		count: number;
		totalSizeBytes: number;
	}

	interface EnvKeyView {
		key: string;
		category: 'editable' | 'secret' | 'readonly';
		sensitive: boolean;
		value?: string;
		preview: string;
		isSet: boolean;
	}

	type Tab = 'general' | 'notifications' | 'monitoring' | 'security' | 'advanced';

	const TABS: { id: Tab; key: TranslationKey }[] = [
		{ id: 'general', key: 'settings.tab.general' },
		{ id: 'notifications', key: 'settings.tab.notifications' },
		{ id: 'monitoring', key: 'settings.tab.monitoring' },
		{ id: 'security', key: 'settings.tab.security' },
		{ id: 'advanced', key: 'settings.tab.advanced' },
	];
	const TAB_IDS = TABS.map((t) => t.id);
	const DEFAULT_TAB: Tab = 'general';

	let activeTab = $derived.by<Tab>(() => {
		const param = $page.url.searchParams.get('tab');
		return param && (TAB_IDS as string[]).includes(param) ? (param as Tab) : DEFAULT_TAB;
	});

	function setTab(tab: Tab) {
		const url = new URL($page.url);
		if (tab === DEFAULT_TAB) url.searchParams.delete('tab');
		else url.searchParams.set('tab', tab);
		goto(url.pathname + (url.search ? url.search : ''), {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	}
	let stats = $state<DashboardStats | null>(null);
	let tmp = $state<TmpStatus | null>(null);
	let cleaningTmp = $state(false);
	let envKeys = $state<EnvKeyView[]>([]);
	let envLoading = $state(true);

	function envValue(k: string): string {
		const entry = envKeys.find((e) => e.key === k);
		return entry?.value ?? '';
	}
	function envIsSet(k: string): boolean {
		return envKeys.find((e) => e.key === k)?.isSet ?? false;
	}

	// SMTP form state
	let smtpEnabled = $state(false);
	let smtpHost = $state('');
	let smtpPort = $state('465');
	let smtpSecure = $state(true);
	let smtpUser = $state('');
	let smtpPass = $state('');
	let smtpPassChanged = $state(false);
	let smtpFrom = $state('');
	let smtpFromName = $state('Sentinel');
	let alertEmail = $state('');
	let smtpSaving = $state(false);
	let smtpDirty = $state(false);
	let testingSmtp = $state(false);
	let smtpTestResult = $state<{ success: boolean; message: string } | null>(null);

	// Monitoring
	let healthchecksUrl = $state('');
	let healthchecksDirty = $state(false);
	let healthchecksSaving = $state(false);

	function syncFromEnv() {
		smtpEnabled = envValue('SMTP_ENABLED') === 'true';
		smtpHost = envValue('SMTP_HOST');
		smtpPort = envValue('SMTP_PORT') || '465';
		smtpSecure = envValue('SMTP_SECURE') !== 'false';
		smtpUser = envValue('SMTP_USER');
		smtpPass = '';
		smtpPassChanged = false;
		smtpFrom = envValue('SMTP_FROM');
		smtpFromName = envValue('SMTP_FROM_NAME') || 'Sentinel';
		alertEmail = envValue('ALERT_EMAIL');
		healthchecksUrl = envValue('HEALTHCHECKS_PING_URL');
		smtpDirty = false;
		healthchecksDirty = false;
	}

	async function loadEnv() {
		envLoading = true;
		try {
			const res = await api.get<{ keys: EnvKeyView[] }>('/settings/env');
			envKeys = res.keys;
			syncFromEnv();
		} finally {
			envLoading = false;
		}
	}

	async function loadTmp() {
		try { tmp = await api.get<TmpStatus>('/dashboard/tmp/status'); } catch { /* ignore */ }
	}

	onMount(async () => {
		try {
			stats = await api.get<DashboardStats>('/dashboard/stats');
		} catch { /* ignore */ }
		await Promise.all([loadEnv(), loadTmp()]);
	});

	async function cleanupTmp() {
		cleaningTmp = true;
		try {
			const result = await api.post<{ cleaned: number }>('/dashboard/tmp/cleanup');
			toast.success(i18n.t('projects.tmp.cleaned', { n: result.cleaned }));
			await loadTmp();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			cleaningTmp = false;
		}
	}

	async function saveSmtp() {
		smtpSaving = true;
		try {
			const updates: Record<string, string> = {
				SMTP_ENABLED: smtpEnabled ? 'true' : 'false',
				SMTP_HOST: smtpHost,
				SMTP_PORT: smtpPort,
				SMTP_SECURE: smtpSecure ? 'true' : 'false',
				SMTP_USER: smtpUser,
				SMTP_FROM: smtpFrom,
				SMTP_FROM_NAME: smtpFromName,
				ALERT_EMAIL: alertEmail,
			};
			if (smtpPassChanged) updates.SMTP_PASS = smtpPass;
			await api.put('/settings/env', { updates });
			toast.success(i18n.t('settings.saved'));
			smtpTestResult = null;
			await loadEnv();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			smtpSaving = false;
		}
	}

	async function saveHealthchecks() {
		healthchecksSaving = true;
		try {
			await api.put('/settings/env', { updates: { HEALTHCHECKS_PING_URL: healthchecksUrl } });
			toast.success(i18n.t('settings.saved'));
			await loadEnv();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			healthchecksSaving = false;
		}
	}

	async function testSmtp() {
		if (smtpDirty) {
			toast.error(i18n.t('settings.smtp.test_warning'));
			return;
		}
		testingSmtp = true;
		smtpTestResult = null;
		try {
			const result = await api.post<{ success: boolean; message: string }>('/dashboard/smtp/test');
			smtpTestResult = result;
			if (result.success) toast.success(result.message);
			else toast.error(result.message);
		} catch (err) {
			smtpTestResult = { success: false, message: translateError(err) };
			toast.error(smtpTestResult.message);
		} finally {
			testingSmtp = false;
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function categoryLabel(cat: 'editable' | 'readonly' | 'secret'): string {
		return i18n.t(`settings.advanced.cat.${cat}` as TranslationKey);
	}

	function categoryColor(cat: 'editable' | 'readonly' | 'secret'): string {
		if (cat === 'editable') return 'bg-success/15 text-success';
		if (cat === 'secret') return 'bg-danger/15 text-danger';
		return 'bg-surface-700 text-surface-500';
	}
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<h1 class="text-2xl font-bold text-white">{i18n.t('settings.title')}</h1>

	<!-- Tab nav -->
	<nav class="flex flex-wrap gap-1 border-b border-surface-700">
		{#each TABS as tab}
			<button
				onclick={() => setTab(tab.id)}
				class="-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm transition {activeTab === tab.id
					? 'border-accent text-accent'
					: 'border-transparent text-surface-500 hover:text-slate-300'}"
			>
				{i18n.t(tab.key)}
			</button>
		{/each}
	</nav>

	<!-- ============ GENERAL ============ -->
	{#if activeTab === 'general'}
		{#if stats}
			<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
				<h2 class="text-lg font-semibold text-white">{i18n.t('settings.stats.title')}</h2>
				<div class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
					<div>
						<p class="text-sm text-surface-600">{i18n.t('settings.stats.projects')}</p>
						<p class="text-xl font-bold text-white">{stats.totalProjects}</p>
					</div>
					<div>
						<p class="text-sm text-surface-600">{i18n.t('settings.stats.backups')}</p>
						<p class="text-xl font-bold text-white">{stats.totalBackups}</p>
					</div>
					<div>
						<p class="text-sm text-surface-600">{i18n.t('settings.stats.disk')}</p>
						<p class="text-xl font-bold text-white">{formatBytes(stats.totalSizeBytes)}</p>
					</div>
					<div>
						<p class="text-sm text-surface-600">{i18n.t('settings.stats.schedules')}</p>
						<p class="text-xl font-bold text-white">{stats.activeSchedules}</p>
					</div>
					<div>
						<p class="text-sm text-surface-600">{i18n.t('settings.stats.failures')}</p>
						<p class="text-xl font-bold" class:text-danger={stats.failedCount > 0} class:text-success={stats.failedCount === 0}>
							{stats.failedCount}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<h2 class="text-lg font-semibold text-white">{i18n.t('settings.tmp.title')}</h2>
			{#if tmp}
				<div class="mt-4 flex items-center justify-between">
					<div class="text-sm">
						{#if tmp.count === 0}
							<span class="text-success">{i18n.t('settings.tmp.empty')}</span>
						{:else}
							<span class="text-warning">{i18n.tn('settings.tmp.count', tmp.count)}</span>
							<span class="ml-2 text-surface-600">({formatBytes(tmp.totalSizeBytes)})</span>
						{/if}
					</div>
					{#if tmp.count > 0}
						<button onclick={cleanupTmp} disabled={cleaningTmp} class="rounded-lg bg-warning/20 px-4 py-2 text-sm text-warning transition hover:bg-warning/30 disabled:opacity-50">
							{cleaningTmp ? i18n.t('settings.tmp.cleaning') : i18n.t('settings.tmp.cleanup')}
						</button>
					{/if}
				</div>
				<p class="mt-2 text-xs text-surface-600">{i18n.t('settings.tmp.help')}</p>
			{/if}
		</div>
	{/if}

	<!-- ============ NOTIFICATIONS ============ -->
	{#if activeTab === 'notifications'}
		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<div class="flex items-start justify-between">
				<div>
					<h2 class="text-lg font-semibold text-white">{i18n.t('settings.smtp.title')}</h2>
					<p class="mt-1 text-sm text-surface-600">{i18n.t('settings.smtp.subtitle')}</p>
				</div>
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={smtpEnabled} onchange={() => (smtpDirty = true)} class="h-4 w-4 rounded accent-accent" />
					<span class="text-sm text-slate-300">{i18n.t('settings.smtp.enabled')}</span>
				</label>
			</div>

			<div class="mt-5 grid gap-4 sm:grid-cols-[1fr_auto]">
				<div>
					<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.host')}</label>
					<input type="text" bind:value={smtpHost} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.host_placeholder')} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white placeholder-surface-600 focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.port')}</label>
					<input type="number" bind:value={smtpPort} oninput={() => (smtpDirty = true)} class="w-24 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
				</div>
			</div>

			<label class="mt-4 flex items-center gap-2 cursor-pointer">
				<input type="checkbox" bind:checked={smtpSecure} onchange={() => (smtpDirty = true)} class="h-4 w-4 rounded accent-accent" />
				<span class="text-sm text-slate-300">{i18n.t('settings.smtp.secure')}</span>
				<span class="text-xs text-surface-500">{i18n.t('settings.smtp.secure_help')}</span>
			</label>

			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.user')}</label>
					<input type="text" bind:value={smtpUser} oninput={() => (smtpDirty = true)} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.pass')}</label>
					<input type="password" bind:value={smtpPass} oninput={() => { smtpDirty = true; smtpPassChanged = true; }} placeholder={envIsSet('SMTP_PASS') ? '••••••••' : ''} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white placeholder-surface-600 focus:border-accent focus:outline-none" />
				</div>
			</div>

			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div>
					<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.from')}</label>
					<input type="email" bind:value={smtpFrom} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.from_placeholder')} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white placeholder-surface-600 focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.from_name')}</label>
					<input type="text" bind:value={smtpFromName} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.from_name_placeholder')} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-white placeholder-surface-600 focus:border-accent focus:outline-none" />
				</div>
			</div>

			<div class="mt-4">
				<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.smtp.alert_email')}</label>
				<input type="email" bind:value={alertEmail} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.alert_email_placeholder')} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white placeholder-surface-600 focus:border-accent focus:outline-none" />
			</div>

			<div class="mt-5 flex flex-wrap items-center gap-3">
				<button onclick={saveSmtp} disabled={!smtpDirty || smtpSaving} class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
					{smtpSaving ? i18n.t('settings.saving') : i18n.t('settings.save')}
				</button>
				<button onclick={testSmtp} disabled={testingSmtp || !smtpEnabled || smtpDirty} class="rounded-lg border border-surface-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-surface-800 disabled:opacity-50">
					{testingSmtp ? i18n.t('settings.smtp.testing') : i18n.t('settings.smtp.test')}
				</button>
				{#if smtpTestResult}
					<span class="text-sm" class:text-success={smtpTestResult.success} class:text-danger={!smtpTestResult.success}>
						{smtpTestResult.message}
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ============ MONITORING ============ -->
	{#if activeTab === 'monitoring'}
		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<h2 class="text-lg font-semibold text-white">{i18n.t('settings.monitoring.title')}</h2>
			<p class="mt-1 text-sm text-surface-600">{i18n.t('settings.monitoring.subtitle')}</p>

			<div class="mt-4 flex items-center gap-2 text-sm">
				<span class="inline-flex h-2 w-2 rounded-full {envIsSet('HEALTHCHECKS_PING_URL') ? 'bg-success' : 'bg-surface-600'}"></span>
				<span class={envIsSet('HEALTHCHECKS_PING_URL') ? 'text-success' : 'text-surface-600'}>
					{envIsSet('HEALTHCHECKS_PING_URL') ? i18n.t('settings.monitoring.status_active') : i18n.t('settings.monitoring.status_inactive')}
				</span>
			</div>

			<div class="mt-4">
				<label class="mb-1 block text-xs text-surface-500">{i18n.t('settings.monitoring.url')}</label>
				<input type="url" bind:value={healthchecksUrl} oninput={() => (healthchecksDirty = true)} placeholder={i18n.t('settings.monitoring.url_placeholder')} class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 font-mono text-sm text-white placeholder-surface-600 focus:border-accent focus:outline-none" />
				<p class="mt-1 text-xs text-surface-600">
					{@html i18n.t('settings.monitoring.url_help', {
						service: '<a href="https://healthchecks.io" target="_blank" class="text-accent hover:underline">Healthchecks.io</a>',
					})}
				</p>
			</div>

			<button onclick={saveHealthchecks} disabled={!healthchecksDirty || healthchecksSaving} class="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
				{healthchecksSaving ? i18n.t('settings.saving') : i18n.t('settings.save')}
			</button>

			<div class="mt-5 rounded-lg border border-accent/20 bg-accent/5 p-4">
				<p class="text-xs leading-relaxed text-surface-400">{i18n.t('settings.monitoring.how')}</p>
			</div>
		</div>
	{/if}

	<!-- ============ SECURITY ============ -->
	{#if activeTab === 'security'}
		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<h2 class="text-lg font-semibold text-white">{i18n.t('settings.security.password.title')}</h2>
			<p class="mt-1 text-sm text-surface-600">{i18n.t('settings.security.password.help')}</p>
			<p class="mt-3 rounded-md bg-surface-800 px-3 py-2 text-xs text-surface-400">
				{@html i18n.t('settings.security.password.env_only', {
					var: '<code class="rounded bg-surface-950 px-1 py-0.5 font-mono text-accent">ADMIN_PASSWORD</code>',
					envFile: '<code class="rounded bg-surface-950 px-1 py-0.5 font-mono text-accent">.env</code>',
				})}
			</p>
			<div class="mt-4 flex items-center justify-between rounded-lg bg-surface-800 px-4 py-3">
				<div>
					<p class="text-sm text-slate-300">{i18n.t('settings.security.password.title')}</p>
					<p class="font-mono text-xs text-surface-600">ADMIN_PASSWORD</p>
				</div>
				<span class="rounded-md px-2 py-0.5 text-xs {envIsSet('ADMIN_PASSWORD') ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}">
					{envIsSet('ADMIN_PASSWORD') ? i18n.t('settings.security.keys.set') : i18n.t('settings.security.keys.missing')}
				</span>
			</div>
		</div>

		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<h2 class="text-lg font-semibold text-white">{i18n.t('settings.security.keys.title')}</h2>
			<p class="mt-1 text-sm text-surface-600">{i18n.t('settings.security.keys.help')}</p>

			<div class="mt-4 space-y-3">
				<div class="flex items-center justify-between rounded-lg bg-surface-800 px-4 py-3">
					<div>
						<p class="text-sm text-slate-300">{i18n.t('settings.security.keys.jwt')}</p>
						<p class="font-mono text-xs text-surface-600">JWT_SECRET</p>
					</div>
					<span class="rounded-md px-2 py-0.5 text-xs {envIsSet('JWT_SECRET') ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}">
						{envIsSet('JWT_SECRET') ? i18n.t('settings.security.keys.set') : i18n.t('settings.security.keys.missing')}
					</span>
				</div>
				<div class="flex items-center justify-between rounded-lg bg-surface-800 px-4 py-3">
					<div>
						<p class="text-sm text-slate-300">{i18n.t('settings.security.keys.encryption')}</p>
						<p class="font-mono text-xs text-surface-600">ENCRYPTION_KEY</p>
					</div>
					<span class="rounded-md px-2 py-0.5 text-xs {envIsSet('ENCRYPTION_KEY') ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}">
						{envIsSet('ENCRYPTION_KEY') ? i18n.t('settings.security.keys.set') : i18n.t('settings.security.keys.missing')}
					</span>
				</div>
			</div>

			<div class="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3">
				<p class="text-xs text-danger">{i18n.t('settings.security.keys.encryption_warning')}</p>
			</div>
		</div>
	{/if}

	<!-- ============ ADVANCED (raw .env) ============ -->
	{#if activeTab === 'advanced'}
		<div class="rounded-xl border border-surface-700 bg-surface-900 p-5">
			<h2 class="text-lg font-semibold text-white">{i18n.t('settings.advanced.title')}</h2>
			<p class="mt-1 text-sm text-surface-600">{i18n.t('settings.advanced.subtitle')}</p>
			<p class="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{i18n.t('settings.advanced.warning')}</p>

			{#if envLoading}
				<div class="flex justify-center py-8">
					<div class="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
				</div>
			{:else}
				<div class="mt-4 overflow-hidden rounded-lg border border-surface-800">
					<table class="w-full text-sm">
						<thead class="bg-surface-800/50 text-left text-xs uppercase tracking-wide text-surface-500">
							<tr>
								<th class="px-4 py-2">{i18n.t('settings.advanced.col_key')}</th>
								<th class="px-4 py-2">{i18n.t('settings.advanced.col_value')}</th>
								<th class="px-4 py-2">{i18n.t('settings.advanced.col_category')}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-surface-800">
							{#each envKeys as entry}
								<tr>
									<td class="px-4 py-2 font-mono text-xs text-slate-300">{entry.key}</td>
									<td class="px-4 py-2 font-mono text-xs">
										{#if entry.preview}
											<span class={entry.sensitive ? 'text-warning' : 'text-white'}>{entry.preview}</span>
										{:else}
											<span class="text-surface-600">{i18n.t('settings.advanced.empty_value')}</span>
										{/if}
									</td>
									<td class="px-4 py-2">
										<span class="rounded-md px-2 py-0.5 text-xs {categoryColor(entry.category)}">
											{categoryLabel(entry.category)}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>
