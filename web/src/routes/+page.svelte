<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { alerts as alertsStore } from '$lib/stores/alerts.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatNumber, backupBasename, backupTypeLabel } from '$lib/utils/format';
	import { formatRelative } from '$lib/utils/date';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';

	const PROJECT_COLORS = ['wp', 'cyan', 'violet', 'lime', 'orange', 'pink'];

	interface BackupRow {
		id: number;
		project_id: number;
		project_name: string;
		type: string;
		status: string;
		started_at: string;
		completed_at: string | null;
		size_bytes: number;
		file_path: string | null;
	}

	interface LastFailure {
		project_id: number;
		project_name: string;
		started_at: string;
		backup_id: number;
	}

	interface DashboardStats {
		totalProjects: number;
		activeProjectsCount: number;
		inactiveProjectsCount: number;
		totalBackups: number;
		totalSizeBytes: number;
		failedCount: number;
		lastFailure: LastFailure | null;
		activeSchedules: number;
		recentBackups: BackupRow[];
	}

	interface TmpStatus {
		count: number;
		totalSizeBytes: number;
	}

	let stats = $state<DashboardStats | null>(null);
	let tmp = $state<TmpStatus | null>(null);
	let loading = $state(true);
	let cleaningTmp = $state(false);

	const unreadAlerts = $derived(alertsStore.items.filter((a) => !a.is_read));

	function projectColorClass(id: number): string {
		return PROJECT_COLORS[id % PROJECT_COLORS.length];
	}

	function statusClass(status: string): 'ok' | 'warn' | 'err' {
		if (status === 'success') return 'ok';
		if (status === 'partial') return 'warn';
		return 'err';
	}

	async function load() {
		loading = true;
		try {
			const [s, t] = await Promise.all([
				api.get<DashboardStats>('/dashboard/stats'),
				api.get<TmpStatus>('/dashboard/tmp/status').catch(() => null),
			]);
			stats = s;
			tmp = t;
		} finally {
			loading = false;
		}
		// Charger les alertes (pour le panneau de droite + badge sidebar)
		await alertsStore.loadList();
	}

	async function cleanupTmp() {
		cleaningTmp = true;
		try {
			const result = await api.post<{ cleaned: number }>('/dashboard/tmp/cleanup');
			toast.success(i18n.t('projects.tmp.cleaned', { n: result.cleaned }));
			tmp = await api.get<TmpStatus>('/dashboard/tmp/status');
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			cleaningTmp = false;
		}
	}

	onMount(load);
</script>

<!-- Topbar -->
<div class="topbar">
	<div class="crumbs">
		<a href="/">Sentinel</a>
		<span class="sep">/</span>
		<b>{i18n.t('nav.dashboard')}</b>
	</div>
	<div class="topbar-actions">
		<button class="icon-btn" title={i18n.t('common.refresh')} onclick={load}>
			<svg class="icn"><use href="#i-refresh" /></svg>
		</button>
	</div>
</div>

{#if loading && !stats}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if stats}
	<!-- Hero -->
	<div class="hero">
		<div>
			<h1>{i18n.t('nav.dashboard')}</h1>
			<div class="hero-meta">
				<span><b>{stats.totalProjects}</b> {i18n.tn('dashboard.hero.projects', stats.totalProjects)}</span>
				<span class="sep">·</span>
				<span><b>{formatNumber(stats.totalBackups)}</b> {i18n.tn('dashboard.hero.backups', stats.totalBackups)}</span>
				<span class="sep">·</span>
				<span><b>{formatBytes(stats.totalSizeBytes)}</b> {i18n.t('dashboard.hero.disk')}</span>
				{#if stats.failedCount > 0}
					<span class="sep">·</span>
					<span class="err">
						<svg class="icn icn-sm"><use href="#i-warning" /></svg>
						<b>{stats.failedCount}</b> {i18n.tn('dashboard.hero.failures', stats.failedCount)}
					</span>
				{:else}
					<span class="sep">·</span>
					<span class="ok"><span class="d"></span> {i18n.t('dashboard.hero.all_good')}</span>
				{/if}
			</div>
		</div>
		<div class="hero-actions">
			<a class="btn" href="/projects">
				<svg class="icn"><use href="#i-grid" /></svg>
				{i18n.t('dashboard.actions.view_projects')}
			</a>
			<a class="btn primary" href="/projects/new">
				<svg class="icn"><use href="#i-plus" /></svg>
				{i18n.t('projects.new')}
			</a>
		</div>
	</div>

	<!-- Tmp warning -->
	{#if tmp && tmp.count > 0}
		<div class="tmp-warn">
			<div class="left">
				<svg class="icn"><use href="#i-warning" /></svg>
				<span>{i18n.tn('dashboard.tmp.warning', tmp.count)}</span>
				<span class="size">({formatBytes(tmp.totalSizeBytes)})</span>
			</div>
			<button onclick={cleanupTmp} disabled={cleaningTmp}>
				{cleaningTmp ? i18n.t('projects.tmp.cleaning') : i18n.t('dashboard.tmp.cleanup')}
			</button>
		</div>
	{/if}

	<!-- KPIs -->
	<div class="kpis">
		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('dashboard.kpi.projects')}
				<svg class="icn icn-sm"><use href="#i-grid" /></svg>
			</div>
			<div class="kpi-val">{stats.totalProjects}</div>
			<div class="kpi-foot">
				<b>{stats.activeProjectsCount}</b> {i18n.t('dashboard.kpi.projects_active')}
				{#if stats.inactiveProjectsCount > 0}
					· {stats.inactiveProjectsCount} {i18n.t('dashboard.kpi.projects_paused')}
				{/if}
			</div>
		</div>

		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('dashboard.kpi.total_backups')}
				<svg class="icn icn-sm"><use href="#i-archive" /></svg>
			</div>
			<div class="kpi-val">{formatNumber(stats.totalBackups)}</div>
			<div class="kpi-foot">{i18n.t('dashboard.kpi.backups_foot')}</div>
		</div>

		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('dashboard.kpi.disk_usage')}
				<svg class="icn icn-sm"><use href="#i-disk" /></svg>
			</div>
			<div class="kpi-val">{formatBytes(stats.totalSizeBytes)}</div>
			<div class="kpi-foot">
				<b>{stats.activeSchedules}</b> {i18n.t('dashboard.kpi.active_schedules')}
			</div>
		</div>

		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('dashboard.kpi.recent_failures')}
				<svg class="icn icn-sm"><use href="#i-warning" /></svg>
			</div>
			<div class="kpi-val" class:warn={stats.failedCount > 0} class:ok={stats.failedCount === 0}>
				{stats.failedCount}<small>/ {i18n.t('dashboard.kpi.failures_unit')}</small>
			</div>
			<div class="kpi-foot">
				{#if stats.lastFailure}
					{i18n.t('dashboard.kpi.last_failure')}
					<a href="/projects/{stats.lastFailure.project_id}/backups/{stats.lastFailure.backup_id}">
						<b>{stats.lastFailure.project_name}</b>
					</a>
				{:else}
					{i18n.t('dashboard.kpi.no_failure')}
				{/if}
			</div>
		</div>
	</div>

	<!-- 2 cols: activity + alerts -->
	<div class="cols">
		<!-- Activité récente -->
		<div class="card">
			<div class="card-head">
				<div class="card-title">
					{i18n.t('dashboard.recent_backups')}
					<span class="count">{stats.recentBackups.length} {i18n.t('dashboard.recent_backups.suffix')}</span>
				</div>
				<a class="card-link" href="/projects">{i18n.t('common.see_all')} →</a>
			</div>

			{#if stats.recentBackups.length === 0}
				<div class="empty-state">
					<div class="ico"><svg class="icn"><use href="#i-archive" /></svg></div>
					<strong>{i18n.t('dashboard.empty.title')}</strong>
					<p>{i18n.t('dashboard.empty.help')}</p>
				</div>
			{:else}
				<div>
					{#each stats.recentBackups as backup (backup.id)}
						<a class="act-row {statusClass(backup.status)}" href="/projects/{backup.project_id}/backups/{backup.id}">
							<span class="dot"></span>
							<div class="act-id">
								<div class="act-project">
									<span class="mark {projectColorClass(backup.project_id)}">
										{backup.project_name.charAt(0).toUpperCase()}
									</span>
									{backup.project_name}
								</div>
								<div class="act-file">{backupBasename(backup.file_path, backup.id)}</div>
							</div>
							<span class="act-tag" class:monthly={backup.type === 'monthly'} class:manual={backup.type === 'manual'}>
								{backupTypeLabel(backup.type)}
							</span>
							<span class="act-size" class:dim={backup.size_bytes === 0}>
								{backup.size_bytes === 0 ? '—' : formatBytes(backup.size_bytes)}
							</span>
							<span class="act-date">{formatRelative(backup.started_at)}</span>
							<svg class="icn icn-sm act-chev"><use href="#i-arrow" /></svg>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Alertes non lues -->
		<div class="card">
			<div class="card-head">
				<div class="card-title">
					{i18n.t('dashboard.alerts.title')}
					{#if unreadAlerts.length > 0}
						<span class="count warn">{i18n.t('dashboard.alerts.unread', { n: unreadAlerts.length })}</span>
					{:else}
						<span class="count">{i18n.t('dashboard.alerts.all_read')}</span>
					{/if}
				</div>
				{#if unreadAlerts.length > 0}
					<button class="card-link" onclick={() => alertsStore.markAllRead()}>
						{i18n.t('alerts.mark_all_read')}
					</button>
				{/if}
			</div>

			{#if unreadAlerts.length === 0}
				<div class="empty-state">
					<div class="ico" style="background:rgba(74,222,128,0.08);color:var(--color-success)"><svg class="icn"><use href="#i-check" /></svg></div>
					<strong>{i18n.t('dashboard.alerts.empty.title')}</strong>
					<p>{i18n.t('dashboard.alerts.empty.help')}</p>
				</div>
			{:else}
				{#each unreadAlerts.slice(0, 5) as alert (alert.id)}
					<div class="alert-row">
						<div class="alert-ico" class:warn={alert.type === 'partial'}>
							{#if alert.type === 'partial'}
								<svg class="icn icn-sm"><use href="#i-warning" /></svg>
							{:else}
								<svg class="icn icn-sm"><use href="#i-x" /></svg>
							{/if}
						</div>
						<div class="alert-body">
							<div class="alert-head">
								<span class="project">{alert.project_name}</span>
								<span class="sep">·</span>
								<time>{formatRelative(alert.created_at)}</time>
							</div>
							<p class="alert-msg">{alert.message}</p>
						</div>
						<div class="alert-actions">
							<button class="alert-icn-btn" title={i18n.t('alerts.mark_read')} onclick={() => alertsStore.markRead(alert.id)}>
								<svg class="icn icn-sm"><use href="#i-check" /></svg>
							</button>
						</div>
					</div>
				{/each}

				{#if unreadAlerts.length > 5}
					<div class="alert-foot">
						<a href="/alerts">{i18n.t('dashboard.alerts.see_more', { n: unreadAlerts.length - 5 })} →</a>
					</div>
				{:else}
					<div class="alert-foot">
						<a href="/alerts">{i18n.t('dashboard.alerts.see_all')} →</a>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{:else}
	<div class="card empty-state" style="padding:2rem">
		<strong>{i18n.t('dashboard.load_error')}</strong>
		<p><button class="card-link" onclick={load}>{i18n.t('common.retry')}</button></p>
	</div>
{/if}

<style>
	/* Layout primitives */
	.topbar {
		display: flex; justify-content: space-between; align-items: center;
		padding-bottom: 1.25rem; margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	.crumbs { display: flex; align-items: center; gap: 0.55rem; font-size: 0.82rem; color: var(--color-text-dim); }
	.crumbs a:hover { color: var(--color-text); }
	.crumbs b { color: var(--color-text); font-weight: 500; font-family: 'Geist Mono', monospace; font-size: 0.8rem; }
	.crumbs .sep { opacity: 0.4; }
	.topbar-actions { display: flex; gap: 0.4rem; }
	.icon-btn {
		width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
		border-radius: 6px; color: var(--color-text-dim);
		border: 1px solid transparent; transition: all 0.12s;
	}
	.icon-btn:hover { background: var(--color-card); color: var(--color-text); border-color: var(--color-border); }

	.hero {
		display: flex; justify-content: space-between; align-items: flex-end;
		padding: 1.75rem 0 2rem; gap: 1.5rem; flex-wrap: wrap;
	}
	.hero h1 { font-size: 1.85rem; font-weight: 600; letter-spacing: -0.025em; margin-bottom: 0.5rem; }
	.hero-meta {
		display: flex; align-items: center; gap: 0.55rem;
		font-size: 0.9rem; color: var(--color-text-dim); flex-wrap: wrap;
	}
	.hero-meta b { color: var(--color-text); font-weight: 600; font-family: 'Geist Mono', monospace; }
	.hero-meta .sep { color: var(--color-text-dimmer); }
	.hero-meta .ok { color: var(--color-success); display: inline-flex; align-items: center; gap: 0.35rem; }
	.hero-meta .err { color: var(--color-danger); display: inline-flex; align-items: center; gap: 0.35rem; }
	.hero-meta .ok .d {
		width: 6px; height: 6px; border-radius: 50%; background: currentColor;
		box-shadow: 0 0 6px currentColor;
		animation: pulse 2s ease-in-out infinite;
	}
	@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
	.hero-actions { display: flex; gap: 0.5rem; }

	.btn {
		padding: 0.6rem 1rem; border-radius: 8px;
		font-size: 0.84rem; font-weight: 500;
		border: 1px solid var(--color-border); background: var(--color-card);
		color: var(--color-text); display: inline-flex; align-items: center; gap: 0.45rem;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.btn:hover { border-color: var(--color-border-2); background: var(--color-card-2); }
	.btn.primary {
		background: var(--color-accent); color: #1a1208; border-color: var(--color-accent);
		font-weight: 600;
		box-shadow: 0 0 24px rgba(251, 191, 36, 0.18);
	}
	.btn.primary:hover { background: var(--color-accent-2); border-color: var(--color-accent-2); }

	.tmp-warn {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.85rem 1.1rem; margin-bottom: 1.25rem;
		background: rgba(251, 146, 60, 0.05);
		border: 1px solid rgba(251, 146, 60, 0.22);
		border-radius: 10px;
		font-size: 0.85rem; color: var(--color-warn); gap: 1rem;
	}
	.tmp-warn .left { display: inline-flex; align-items: center; gap: 0.6rem; }
	.tmp-warn .size { color: var(--color-text-dim); font-family: 'Geist Mono', monospace; font-size: 0.78rem; }
	.tmp-warn button {
		padding: 0.4rem 0.85rem; border-radius: 6px;
		background: rgba(251, 146, 60, 0.15);
		border: 1px solid rgba(251, 146, 60, 0.3);
		color: var(--color-warn); font-size: 0.78rem; font-weight: 500;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.tmp-warn button:hover { background: var(--color-warn); color: #1a0c04; border-color: var(--color-warn); }
	.tmp-warn button:disabled { opacity: 0.5; cursor: not-allowed; }

	.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.85rem; margin-bottom: 1.5rem; }
	.kpi { padding: 1.05rem 1.2rem; background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; transition: border-color 0.15s; }
	.kpi:hover { border-color: var(--color-border-2); }
	.kpi-label {
		font-size: 0.7rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.07em;
		display: flex; justify-content: space-between; align-items: center;
	}
	.kpi-label .icn { color: var(--color-text-dimmer); }
	.kpi-val {
		margin: 0.55rem 0 0.25rem; font-size: 1.7rem; font-weight: 600;
		letter-spacing: -0.025em; font-feature-settings: 'tnum';
		display: flex; align-items: baseline; gap: 0.2rem;
	}
	.kpi-val small { font-size: 0.78rem; color: var(--color-text-dim); font-weight: 500; }
	.kpi-val.ok { color: var(--color-success); }
	.kpi-val.warn { color: var(--color-warn); }
	.kpi-foot { font-size: 0.74rem; color: var(--color-text-dim); margin-top: 0.4rem; }
	.kpi-foot b { color: var(--color-text); font-weight: 500; }
	.kpi-foot a { color: var(--color-text); }
	.kpi-foot a:hover b { color: var(--color-accent); }

	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
		gap: 1rem; margin-bottom: 1rem;
	}

	.card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden; }
	.card-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.95rem 1.25rem; border-bottom: 1px solid var(--color-border);
	}
	.card-title { font-size: 0.95rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; }
	.card-title .count {
		font-size: 0.68rem; padding: 0.12rem 0.5rem;
		background: var(--color-border); color: var(--color-text-dim);
		border-radius: 999px; font-family: 'Geist Mono', monospace; font-weight: 500;
	}
	.card-title .count.warn {
		background: rgba(248, 113, 113, 0.12); color: var(--color-danger);
	}
	.card-link {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.4rem 0.7rem; border-radius: 6px;
		font-size: 0.78rem; color: var(--color-text-dim);
		border: 1px solid transparent; transition: all 0.12s;
		background: none; cursor: pointer; font-family: inherit;
	}
	.card-link:hover { color: var(--color-text); border-color: var(--color-border); }

	.empty-state {
		padding: 3rem 1.5rem; text-align: center; color: var(--color-text-dim);
	}
	.empty-state .ico {
		width: 44px; height: 44px; border-radius: 10px;
		background: var(--color-card-2); color: var(--color-text-dim);
		margin: 0 auto 0.85rem;
		display: flex; align-items: center; justify-content: center;
	}
	.empty-state strong { display: block; color: var(--color-text); font-size: 0.95rem; margin-bottom: 0.35rem; }
	.empty-state p { font-size: 0.82rem; }

	/* Activity rows */
	.act-row {
		display: grid;
		grid-template-columns: 12px minmax(0, 1.6fr) 80px 80px 90px 18px;
		gap: 1rem; align-items: center;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		cursor: pointer; transition: background 0.12s;
		text-decoration: none; color: inherit;
	}
	.act-row:hover { background: rgba(251, 191, 36, 0.02); }
	.act-row:last-child { border-bottom: none; }
	.act-row .dot {
		width: 9px; height: 9px; border-radius: 50%;
	}
	.act-row.ok .dot { background: var(--color-success); box-shadow: 0 0 8px rgba(74, 222, 128, 0.5); }
	.act-row.warn .dot { background: var(--color-warn); box-shadow: 0 0 6px rgba(251, 146, 60, 0.5); }
	.act-row.err .dot { background: var(--color-danger); box-shadow: 0 0 6px rgba(248, 113, 113, 0.5); }

	.act-id { min-width: 0; }
	.act-project { font-size: 0.9rem; font-weight: 500; display: flex; align-items: center; gap: 0.55rem; }
	.act-project .mark {
		width: 18px; height: 18px; border-radius: 5px;
		display: flex; align-items: center; justify-content: center;
		font-family: 'Geist Mono', monospace; font-weight: 700;
		font-size: 0.62rem; flex-shrink: 0;
	}
	.act-project .mark.wp { background: rgba(251,191,36,0.12); color: var(--color-accent); }
	.act-project .mark.cyan { background: rgba(34,211,238,0.12); color: var(--color-cyan); }
	.act-project .mark.violet { background: rgba(167,139,250,0.12); color: var(--color-violet); }
	.act-project .mark.lime { background: rgba(74,222,128,0.12); color: var(--color-success); }
	.act-project .mark.orange { background: rgba(251,146,60,0.12); color: var(--color-warn); }
	.act-project .mark.pink { background: rgba(248,113,113,0.12); color: var(--color-danger); }
	.act-file {
		font-family: 'Geist Mono', monospace;
		font-size: 0.74rem; color: var(--color-text-dim);
		margin-top: 0.18rem;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.act-tag {
		font-family: 'Geist Mono', monospace; font-size: 0.66rem;
		padding: 0.18rem 0.5rem; border-radius: 4px;
		background: var(--color-border); color: var(--color-text-dim);
		text-align: center;
	}
	.act-tag.monthly { background: rgba(168, 85, 247, 0.12); color: var(--color-purple); }
	.act-tag.manual { background: rgba(34, 211, 238, 0.12); color: var(--color-cyan); }
	.act-size {
		font-family: 'Geist Mono', monospace; font-size: 0.8rem;
		color: var(--color-text); text-align: right;
	}
	.act-size.dim { color: var(--color-text-dim); }
	.act-date {
		font-family: 'Geist Mono', monospace; font-size: 0.74rem;
		color: var(--color-text-dim); text-align: right;
	}
	.act-chev { color: var(--color-text-dimmer); transition: all 0.15s; }
	.act-row:hover .act-chev { color: var(--color-accent); transform: translateX(2px); }

	/* Alerts rows */
	.alert-row {
		padding: 0.9rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		transition: background 0.12s;
		display: grid; grid-template-columns: 28px 1fr auto; gap: 0.75rem;
		align-items: flex-start;
	}
	.alert-row:last-child { border-bottom: none; }
	.alert-row:hover { background: rgba(248, 113, 113, 0.025); }
	.alert-ico {
		width: 28px; height: 28px; border-radius: 7px;
		background: rgba(248, 113, 113, 0.1); color: var(--color-danger);
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0; margin-top: 0.1rem;
	}
	.alert-ico.warn { background: rgba(251, 146, 60, 0.1); color: var(--color-warn); }
	.alert-body { min-width: 0; }
	.alert-head {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.78rem; color: var(--color-text-dim); margin-bottom: 0.3rem;
	}
	.alert-head .project { color: var(--color-text); font-weight: 500; }
	.alert-head .sep { color: var(--color-text-dimmer); }
	.alert-head time { font-family: 'Geist Mono', monospace; font-size: 0.72rem; }
	.alert-msg {
		font-size: 0.85rem; color: var(--color-text); line-height: 1.45;
	}
	.alert-actions { opacity: 0; transition: opacity 0.12s; }
	.alert-row:hover .alert-actions { opacity: 1; }
	.alert-icn-btn {
		width: 26px; height: 26px; border-radius: 5px;
		display: flex; align-items: center; justify-content: center;
		color: var(--color-text-dimmer); transition: all 0.12s;
		background: none; border: none; cursor: pointer;
	}
	.alert-icn-btn:hover { color: var(--color-text); background: rgba(255,255,255,0.05); }
	.alert-foot {
		padding: 0.8rem 1.25rem;
		border-top: 1px solid var(--color-border);
		text-align: center;
	}
	.alert-foot a {
		font-size: 0.8rem; color: var(--color-text-dim);
		border-bottom: 1px dashed currentColor;
	}
	.alert-foot a:hover { color: var(--color-text); }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }
	.icn-sm { width: 12px; height: 12px; }

	@media (max-width: 1100px) {
		.cols { grid-template-columns: 1fr; }
		.kpis { grid-template-columns: repeat(2, 1fr); }
	}
	@media (max-width: 760px) {
		.hero { flex-direction: column; align-items: flex-start; }
		.hero-actions { width: 100%; flex-wrap: wrap; }
		.hero-actions .btn { flex: 1; justify-content: center; }
		.act-row { grid-template-columns: 12px 1fr auto 18px; padding: 0.75rem 1rem; }
		.act-tag, .act-date { display: none; }
		.card-head { padding: 0.85rem 1rem; }
		.tmp-warn { flex-direction: column; align-items: flex-start; }
		.tmp-warn button { width: 100%; text-align: center; }
		.crumbs { font-size: 0.78rem; }
		.crumbs b { font-size: 0.76rem; }
	}
	@media (max-width: 480px) {
		.kpis { grid-template-columns: 1fr; }
	}
</style>
