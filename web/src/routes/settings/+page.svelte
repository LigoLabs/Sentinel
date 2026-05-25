<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import { formatBytes } from '$lib/utils/format';
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

	const TABS: { id: Tab; key: TranslationKey; icon: string }[] = [
		{ id: 'general', key: 'settings.tab.general', icon: 'i-activity' },
		{ id: 'notifications', key: 'settings.tab.notifications', icon: 'i-mail' },
		{ id: 'monitoring', key: 'settings.tab.monitoring', icon: 'i-bell' },
		{ id: 'security', key: 'settings.tab.security', icon: 'i-shield' },
		{ id: 'advanced', key: 'settings.tab.advanced', icon: 'i-terminal' },
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

	function categoryLabel(cat: 'editable' | 'readonly' | 'secret'): string {
		return i18n.t(`settings.advanced.cat.${cat}` as TranslationKey);
	}
</script>

<!-- Topbar -->
<div class="topbar">
	<div class="crumbs">
		<a href="/">Sentinel</a>
		<span class="sep">/</span>
		<b>{i18n.t('settings.title')}</b>
	</div>
</div>

<!-- Hero -->
<div class="hero">
	<h1>{i18n.t('settings.title')}</h1>
	<p>{i18n.t('settings.hero_help')}</p>
</div>

<!-- Tab nav -->
<nav class="tabs">
	{#each TABS as tab}
		<button class="tab" class:active={activeTab === tab.id} onclick={() => setTab(tab.id)}>
			<svg class="icn"><use href="#{tab.icon}" /></svg>
			{i18n.t(tab.key)}
		</button>
	{/each}
</nav>

<div class="content">
	<!-- ============ GENERAL ============ -->
	{#if activeTab === 'general'}
		{#if stats}
			<div class="card">
				<div class="card-head"><div class="card-title">{i18n.t('settings.stats.title')}</div></div>
				<div class="card-body">
					<div class="stats-grid">
						<div class="stat-cell">
							<div class="stat-label">{i18n.t('settings.stats.projects')}</div>
							<div class="stat-val">{stats.totalProjects}</div>
						</div>
						<div class="stat-cell">
							<div class="stat-label">{i18n.t('settings.stats.backups')}</div>
							<div class="stat-val">{stats.totalBackups}</div>
						</div>
						<div class="stat-cell">
							<div class="stat-label">{i18n.t('settings.stats.disk')}</div>
							<div class="stat-val">{formatBytes(stats.totalSizeBytes)}</div>
						</div>
						<div class="stat-cell">
							<div class="stat-label">{i18n.t('settings.stats.schedules')}</div>
							<div class="stat-val">{stats.activeSchedules}</div>
						</div>
						<div class="stat-cell">
							<div class="stat-label">{i18n.t('settings.stats.failures')}</div>
							<div class="stat-val" class:warn={stats.failedCount > 0} class:ok={stats.failedCount === 0}>
								{stats.failedCount}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<div class="card">
			<div class="card-head"><div class="card-title">{i18n.t('settings.tmp.title')}</div></div>
			<div class="card-body">
				{#if tmp}
					{#if tmp.count === 0}
						<div class="tmp-row ok">
							<div class="tmp-left">
								<svg class="icn" style="color:var(--color-success)"><use href="#i-check" /></svg>
								<span class="ok">{i18n.t('settings.tmp.empty')}</span>
							</div>
						</div>
					{:else}
						<div class="tmp-row warn">
							<div class="tmp-left">
								<svg class="icn" style="color:var(--color-warn)"><use href="#i-warning" /></svg>
								<span class="warn">{i18n.tn('settings.tmp.count', tmp.count)}</span>
								<span class="size">({formatBytes(tmp.totalSizeBytes)})</span>
							</div>
							<button class="btn warn-btn" onclick={cleanupTmp} disabled={cleaningTmp}>
								{cleaningTmp ? i18n.t('settings.tmp.cleaning') : i18n.t('settings.tmp.cleanup')}
							</button>
						</div>
					{/if}
					<p class="help">{i18n.t('settings.tmp.help')}</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ============ NOTIFICATIONS ============ -->
	{#if activeTab === 'notifications'}
		<div class="card">
			<div class="card-head">
				<div>
					<div class="card-title">{i18n.t('settings.smtp.title')}</div>
					<p class="card-help">{i18n.t('settings.smtp.subtitle')}</p>
				</div>
				<label class="toggle-line inline">
					<input type="checkbox" bind:checked={smtpEnabled} onchange={() => (smtpDirty = true)} />
					<span>{i18n.t('settings.smtp.enabled')}</span>
				</label>
			</div>

			<div class="card-body">
				<div class="grid-2">
					<div class="field">
						<label for="smtp-host">{i18n.t('settings.smtp.host')}</label>
						<input id="smtp-host" type="text" class="mono" bind:value={smtpHost} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.host_placeholder')} />
					</div>
					<div class="field">
						<label for="smtp-port">{i18n.t('settings.smtp.port')}</label>
						<input id="smtp-port" type="number" class="mono" bind:value={smtpPort} oninput={() => (smtpDirty = true)} />
					</div>
				</div>

				<label class="toggle-line">
					<input type="checkbox" bind:checked={smtpSecure} onchange={() => (smtpDirty = true)} />
					<span>{i18n.t('settings.smtp.secure')}</span>
					<small>{i18n.t('settings.smtp.secure_help')}</small>
				</label>

				<div class="grid-2">
					<div class="field">
						<label for="smtp-user">{i18n.t('settings.smtp.user')}</label>
						<input id="smtp-user" type="text" class="mono" bind:value={smtpUser} oninput={() => (smtpDirty = true)} />
					</div>
					<div class="field">
						<label for="smtp-pass">{i18n.t('settings.smtp.pass')}</label>
						<input id="smtp-pass" type="password" class="mono" bind:value={smtpPass} oninput={() => { smtpDirty = true; smtpPassChanged = true; }} placeholder={envIsSet('SMTP_PASS') ? '••••••••' : ''} />
					</div>
				</div>

				<div class="grid-2">
					<div class="field">
						<label for="smtp-from">{i18n.t('settings.smtp.from')}</label>
						<input id="smtp-from" type="email" class="mono" bind:value={smtpFrom} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.from_placeholder')} />
					</div>
					<div class="field">
						<label for="smtp-from-name">{i18n.t('settings.smtp.from_name')}</label>
						<input id="smtp-from-name" type="text" bind:value={smtpFromName} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.from_name_placeholder')} />
					</div>
				</div>

				<div class="field">
					<label for="alert-email">{i18n.t('settings.smtp.alert_email')}</label>
					<input id="alert-email" type="email" class="mono" bind:value={alertEmail} oninput={() => (smtpDirty = true)} placeholder={i18n.t('settings.smtp.alert_email_placeholder')} />
				</div>

				<div class="actions">
					<button class="btn primary" onclick={saveSmtp} disabled={!smtpDirty || smtpSaving}>
						{smtpSaving ? i18n.t('settings.saving') : i18n.t('settings.save')}
					</button>
					<button class="btn" onclick={testSmtp} disabled={testingSmtp || !smtpEnabled || smtpDirty}>
						{testingSmtp ? i18n.t('settings.smtp.testing') : i18n.t('settings.smtp.test')}
					</button>
					{#if smtpTestResult}
						<span class:text-success={smtpTestResult.success} class:text-danger={!smtpTestResult.success} class="test-result">
							{smtpTestResult.message}
						</span>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- ============ MONITORING ============ -->
	{#if activeTab === 'monitoring'}
		<div class="card">
			<div class="card-head">
				<div>
					<div class="card-title">{i18n.t('settings.monitoring.title')}</div>
					<p class="card-help">{i18n.t('settings.monitoring.subtitle')}</p>
				</div>
			</div>
			<div class="card-body">
				<div class="status-line" class:ok={envIsSet('HEALTHCHECKS_PING_URL')}>
					<span class="dot"></span>
					<span>
						{envIsSet('HEALTHCHECKS_PING_URL')
							? i18n.t('settings.monitoring.status_active')
							: i18n.t('settings.monitoring.status_inactive')}
					</span>
				</div>

				<div class="field">
					<label for="hc-url">{i18n.t('settings.monitoring.url')}</label>
					<input id="hc-url" type="url" class="mono" bind:value={healthchecksUrl} oninput={() => (healthchecksDirty = true)} placeholder={i18n.t('settings.monitoring.url_placeholder')} />
					<p class="field-help">
						{@html i18n.t('settings.monitoring.url_help', {
							service: '<a href="https://healthchecks.io" target="_blank" rel="noopener" class="link-accent">Healthchecks.io</a>',
						})}
					</p>
				</div>

				<div class="actions">
					<button class="btn primary" onclick={saveHealthchecks} disabled={!healthchecksDirty || healthchecksSaving}>
						{healthchecksSaving ? i18n.t('settings.saving') : i18n.t('settings.save')}
					</button>
				</div>

				<div class="info-box">
					<p>{i18n.t('settings.monitoring.how')}</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- ============ SECURITY ============ -->
	{#if activeTab === 'security'}
		<div class="card">
			<div class="card-head"><div>
				<div class="card-title">{i18n.t('settings.security.password.title')}</div>
				<p class="card-help">{i18n.t('settings.security.password.help')}</p>
			</div></div>
			<div class="card-body">
				<div class="info-box subtle">
					{@html i18n.t('settings.security.password.env_only', {
						var: '<code class="code-accent">ADMIN_PASSWORD</code>',
						envFile: '<code class="code-accent">.env</code>',
					})}
				</div>
				<div class="key-row">
					<div>
						<p class="key-name">{i18n.t('settings.security.password.title')}</p>
						<p class="key-env mono">ADMIN_PASSWORD</p>
					</div>
					<span class="pill" class:ok={envIsSet('ADMIN_PASSWORD')} class:err={!envIsSet('ADMIN_PASSWORD')}>
						{envIsSet('ADMIN_PASSWORD') ? i18n.t('settings.security.keys.set') : i18n.t('settings.security.keys.missing')}
					</span>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-head"><div>
				<div class="card-title">{i18n.t('settings.security.keys.title')}</div>
				<p class="card-help">{i18n.t('settings.security.keys.help')}</p>
			</div></div>
			<div class="card-body">
				<div class="keys-list">
					<div class="key-row">
						<div>
							<p class="key-name">{i18n.t('settings.security.keys.jwt')}</p>
							<p class="key-env mono">JWT_SECRET</p>
						</div>
						<span class="pill" class:ok={envIsSet('JWT_SECRET')} class:err={!envIsSet('JWT_SECRET')}>
							{envIsSet('JWT_SECRET') ? i18n.t('settings.security.keys.set') : i18n.t('settings.security.keys.missing')}
						</span>
					</div>
					<div class="key-row">
						<div>
							<p class="key-name">{i18n.t('settings.security.keys.encryption')}</p>
							<p class="key-env mono">ENCRYPTION_KEY</p>
						</div>
						<span class="pill" class:ok={envIsSet('ENCRYPTION_KEY')} class:err={!envIsSet('ENCRYPTION_KEY')}>
							{envIsSet('ENCRYPTION_KEY') ? i18n.t('settings.security.keys.set') : i18n.t('settings.security.keys.missing')}
						</span>
					</div>
				</div>
				<div class="danger-box">
					<svg class="icn"><use href="#i-warning" /></svg>
					<p>{i18n.t('settings.security.keys.encryption_warning')}</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- ============ ADVANCED (raw .env) ============ -->
	{#if activeTab === 'advanced'}
		<div class="card">
			<div class="card-head"><div>
				<div class="card-title">{i18n.t('settings.advanced.title')}</div>
				<p class="card-help">{i18n.t('settings.advanced.subtitle')}</p>
			</div></div>
			<div class="card-body">
				<div class="info-box warn-box">
					<svg class="icn"><use href="#i-warning" /></svg>
					<p>{i18n.t('settings.advanced.warning')}</p>
				</div>

				{#if envLoading}
					<div class="flex justify-center py-8">
						<div class="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
					</div>
				{:else}
					<div class="env-table-wrap">
						<table class="env-table">
							<thead><tr>
								<th>{i18n.t('settings.advanced.col_key')}</th>
								<th>{i18n.t('settings.advanced.col_value')}</th>
								<th>{i18n.t('settings.advanced.col_category')}</th>
							</tr></thead>
							<tbody>
								{#each envKeys as entry (entry.key)}
									<tr>
										<td class="mono key-cell">{entry.key}</td>
										<td class="mono">
											{#if entry.preview}
												<span class:sens={entry.sensitive}>{entry.preview}</span>
											{:else}
												<span class="dim">{i18n.t('settings.advanced.empty_value')}</span>
											{/if}
										</td>
										<td>
											<span class="cat-pill" class:edit={entry.category === 'editable'} class:secret={entry.category === 'secret'} class:read={entry.category === 'readonly'}>
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
		</div>
	{/if}
</div>

<style>
	.topbar {
		display: flex; justify-content: space-between; align-items: center;
		padding-bottom: 1.25rem; margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	.crumbs { display: flex; align-items: center; gap: 0.55rem; font-size: 0.82rem; color: var(--color-text-dim); }
	.crumbs a:hover { color: var(--color-text); }
	.crumbs b { color: var(--color-text); font-weight: 500; }
	.crumbs .sep { opacity: 0.4; }

	.hero { padding: 1.75rem 0 1.5rem; }
	.hero h1 { font-size: 1.85rem; font-weight: 600; letter-spacing: -0.025em; margin-bottom: 0.5rem; }
	.hero p { font-size: 0.9rem; color: var(--color-text-dim); line-height: 1.55; }

	.tabs {
		display: flex; gap: 0.15rem;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 1.5rem;
		overflow-x: auto;
		scrollbar-width: none;       /* Firefox */
		-ms-overflow-style: none;    /* IE/Edge legacy */
	}
	.tabs::-webkit-scrollbar { display: none; }
	.tab {
		padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--color-text-dim);
		border-bottom: 2px solid transparent; margin-bottom: -1px;
		display: inline-flex; align-items: center; gap: 0.45rem;
		transition: color 0.12s; white-space: nowrap;
		background: none; border-top: none; border-left: none; border-right: none;
		cursor: pointer; font-family: inherit;
	}
	.tab:hover { color: var(--color-text); }
	.tab.active { color: var(--color-text); border-bottom-color: var(--color-accent); font-weight: 500; }

	.content { width: 100%; }

	.card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
	.card-head { padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
	.card-title { font-size: 0.95rem; font-weight: 600; }
	.card-help { margin-top: 0.3rem; font-size: 0.8rem; color: var(--color-text-dim); }
	.card-body { padding: 1.25rem; }

	/* Stats grid */
	.stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.85rem; }
	.stat-cell { padding: 0.85rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 9px; }
	.stat-label {
		font-size: 0.7rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.07em;
	}
	.stat-val {
		margin-top: 0.4rem; font-size: 1.4rem; font-weight: 600;
		letter-spacing: -0.025em; font-feature-settings: 'tnum';
	}
	.stat-val.ok { color: var(--color-success); }
	.stat-val.warn { color: var(--color-warn); }

	/* Tmp row */
	.tmp-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.85rem 1.1rem; background: var(--color-bg);
		border: 1px solid var(--color-border); border-radius: 9px; margin-bottom: 0.85rem;
	}
	.tmp-row.warn { background: rgba(251, 146, 60, 0.04); border-color: rgba(251, 146, 60, 0.25); }
	.tmp-row.ok { background: rgba(74, 222, 128, 0.04); border-color: rgba(74, 222, 128, 0.25); }
	.tmp-left { display: inline-flex; align-items: center; gap: 0.55rem; font-size: 0.88rem; }
	.tmp-left .warn { color: var(--color-warn); }
	.tmp-left .ok { color: var(--color-success); }
	.tmp-left .size { color: var(--color-text-dim); font-family: 'Geist Mono', monospace; font-size: 0.78rem; }
	.help { font-size: 0.78rem; color: var(--color-text-dim); line-height: 1.55; }

	/* Form */
	.field { margin-bottom: 1.1rem; }
	.field:last-child { margin-bottom: 0; }
	.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.1rem; }
	.grid-2:last-child { margin-bottom: 0; }
	.field label {
		display: block;
		font-size: 0.78rem; font-weight: 500;
		color: var(--color-text); margin-bottom: 0.45rem;
	}
	.field input {
		width: 100%; padding: 0.6rem 0.85rem;
		background: var(--color-bg); color: var(--color-text);
		border: 1px solid var(--color-border); border-radius: 8px;
		font: inherit; transition: border-color 0.12s;
		font-size: 0.88rem;
	}
	.field input:focus {
		outline: none; border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.1);
	}
	.field input.mono { font-family: 'Geist Mono', monospace; font-size: 0.85rem; }
	.field input::placeholder { color: var(--color-text-dimmer); }
	.field-help { margin-top: 0.4rem; font-size: 0.76rem; color: var(--color-text-dim); }
	.field-help :global(.link-accent) { color: var(--color-accent); }
	.field-help :global(.link-accent:hover) { color: var(--color-accent-2); }

	.toggle-line {
		display: flex; align-items: center; gap: 0.6rem;
		cursor: pointer; padding: 0.6rem 0.85rem;
		background: var(--color-bg); border: 1px solid var(--color-border);
		border-radius: 8px;
		font-size: 0.85rem; color: var(--color-text);
		margin-bottom: 1.1rem; flex-wrap: wrap;
	}
	.toggle-line.inline { padding: 0.35rem 0.75rem; margin: 0; background: var(--color-bg); }
	.toggle-line:hover { border-color: var(--color-border-2); }
	.toggle-line input { accent-color: var(--color-accent); width: 16px; height: 16px; cursor: pointer; }
	.toggle-line small { color: var(--color-text-dim); font-size: 0.76rem; }

	.actions {
		display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;
		margin-top: 1.25rem;
	}
	.test-result { font-size: 0.85rem; }
	.text-success { color: var(--color-success); }
	.text-danger { color: var(--color-danger); }

	.btn {
		padding: 0.55rem 1rem; border-radius: 8px;
		font-size: 0.84rem; font-weight: 500;
		border: 1px solid var(--color-border); background: var(--color-card);
		color: var(--color-text); display: inline-flex; align-items: center; gap: 0.45rem;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.btn:hover:not(:disabled) { border-color: var(--color-border-2); background: var(--color-card-2); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn.primary { background: var(--color-accent); color: #1a1208; border-color: var(--color-accent); font-weight: 600; }
	.btn.primary:hover:not(:disabled) { background: var(--color-accent-2); border-color: var(--color-accent-2); }
	.warn-btn {
		padding: 0.4rem 0.85rem; border-radius: 6px;
		background: rgba(251, 146, 60, 0.15);
		border: 1px solid rgba(251, 146, 60, 0.3);
		color: var(--color-warn); font-size: 0.78rem; font-weight: 500;
		cursor: pointer; font-family: inherit;
	}
	.warn-btn:hover:not(:disabled) { background: var(--color-warn); color: #1a0c04; border-color: var(--color-warn); }

	/* Status line (monitoring active/inactive) */
	.status-line {
		display: inline-flex; align-items: center; gap: 0.5rem;
		font-size: 0.85rem; color: var(--color-text-dim);
		margin-bottom: 1.25rem;
	}
	.status-line .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-dimmer); }
	.status-line.ok { color: var(--color-success); }
	.status-line.ok .dot { background: var(--color-success); box-shadow: 0 0 8px var(--color-success); }

	/* Info boxes */
	.info-box {
		padding: 0.95rem 1.1rem; border-radius: 10px;
		background: rgba(251, 191, 36, 0.05);
		border: 1px solid rgba(251, 191, 36, 0.2);
		font-size: 0.82rem; color: var(--color-text-dim); line-height: 1.55;
		margin-top: 1rem;
	}
	.info-box.subtle {
		background: var(--color-bg); border-color: var(--color-border);
		margin-top: 0; margin-bottom: 1rem;
	}
	.info-box.warn-box {
		background: rgba(251, 146, 60, 0.05);
		border-color: rgba(251, 146, 60, 0.25);
		display: flex; gap: 0.6rem; align-items: flex-start;
		color: var(--color-warn);
		margin-top: 0; margin-bottom: 1rem;
	}
	.info-box.warn-box p { color: var(--color-text); }
	.info-box.warn-box .icn { flex-shrink: 0; margin-top: 0.15rem; }
	.info-box :global(code.code-accent) {
		font-family: 'Geist Mono', monospace; font-size: 0.78rem;
		padding: 0.1rem 0.4rem; border-radius: 4px;
		background: rgba(0, 0, 0, 0.3); color: var(--color-accent);
	}

	.danger-box {
		margin-top: 1rem; padding: 0.85rem 1.1rem;
		background: rgba(248, 113, 113, 0.05);
		border: 1px solid rgba(248, 113, 113, 0.25);
		border-radius: 10px;
		display: flex; gap: 0.6rem; align-items: flex-start;
		font-size: 0.82rem; color: var(--color-danger); line-height: 1.55;
	}
	.danger-box .icn { flex-shrink: 0; margin-top: 0.1rem; }

	/* Security keys */
	.keys-list { display: flex; flex-direction: column; gap: 0.6rem; }
	.key-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.85rem 1.1rem;
		background: var(--color-bg); border: 1px solid var(--color-border);
		border-radius: 9px; gap: 1rem;
	}
	.key-name { font-size: 0.88rem; color: var(--color-text); font-weight: 500; }
	.key-env { font-size: 0.76rem; color: var(--color-text-dim); margin-top: 0.15rem; }
	.pill {
		padding: 0.18rem 0.6rem; border-radius: 999px;
		font-size: 0.72rem; font-weight: 500;
	}
	.pill.ok { background: rgba(74, 222, 128, 0.1); color: var(--color-success); }
	.pill.err { background: rgba(248, 113, 113, 0.1); color: var(--color-danger); }

	/* Env table */
	.env-table-wrap {
		border: 1px solid var(--color-border); border-radius: 10px; overflow: hidden;
	}
	.env-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
	.env-table th {
		text-align: left; padding: 0.6rem 0.9rem;
		font-size: 0.66rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.08em;
		border-bottom: 1px solid var(--color-border);
		background: rgba(0, 0, 0, 0.2);
	}
	.env-table td {
		padding: 0.55rem 0.9rem; border-bottom: 1px solid var(--color-border);
	}
	.env-table tbody tr:last-child td { border-bottom: none; }
	.env-table .mono { font-family: 'Geist Mono', monospace; font-size: 0.78rem; }
	.env-table .key-cell { color: var(--color-text); }
	.env-table .sens { color: var(--color-warn); }
	.env-table .dim { color: var(--color-text-dimmer); }
	.cat-pill {
		padding: 0.12rem 0.5rem; border-radius: 999px;
		font-size: 0.68rem; font-weight: 500;
	}
	.cat-pill.edit { background: rgba(74, 222, 128, 0.12); color: var(--color-success); }
	.cat-pill.secret { background: rgba(248, 113, 113, 0.12); color: var(--color-danger); }
	.cat-pill.read { background: var(--color-border); color: var(--color-text-dim); }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }

	@media (max-width: 1100px) {
		.stats-grid { grid-template-columns: repeat(3, 1fr); }
	}
	@media (max-width: 760px) {
		.stats-grid { grid-template-columns: repeat(2, 1fr); }
		.grid-2 { grid-template-columns: 1fr; }
		.crumbs { font-size: 0.78rem; }
		.card-head { padding: 0.85rem 1rem; flex-direction: column; align-items: flex-start; gap: 0.6rem; }
		.card-head .toggle-line.inline { width: 100%; justify-content: flex-start; }
		.card-body { padding: 1rem; }
		.tmp-row { flex-direction: column; align-items: flex-start; gap: 0.6rem; padding: 0.85rem 1rem; }
		.tmp-row .warn-btn { width: 100%; text-align: center; }
		.tmp-left { flex-wrap: wrap; }
		.actions { flex-direction: column; align-items: stretch; }
		.actions .btn { width: 100%; justify-content: center; }
		/* Env table — scroll horizontal */
		.env-table-wrap { overflow-x: auto; }
		.env-table { min-width: 540px; }
	}
	@media (max-width: 480px) {
		.stats-grid { grid-template-columns: 1fr; }
	}
</style>
