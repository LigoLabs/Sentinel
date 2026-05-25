<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { projectsStore, type ProjectListItem } from '$lib/stores/projects.svelte';
	import { formatBytes, formatNumber } from '$lib/utils/format';
	import { formatRelative } from '$lib/utils/date';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';

	const PROJECT_COLORS = ['wp', 'cyan', 'violet', 'lime', 'orange', 'pink'];
	type Filter = 'all' | 'active' | 'paused' | 'failed';
	let filter = $state<Filter>('all');

	interface TmpStatus {
		count: number;
		totalSizeBytes: number;
	}
	let tmp = $state<TmpStatus | null>(null);
	let cleaningTmp = $state(false);

	const projects = $derived(projectsStore.items);
	const counts = $derived.by(() => {
		const a = projects.filter((p) => p.is_active).length;
		const p = projects.length - a;
		const f = projects.filter((x) => x.lastBackup?.status === 'failed').length;
		return { all: projects.length, active: a, paused: p, failed: f };
	});

	const filteredProjects = $derived.by(() => {
		if (filter === 'active') return projects.filter((p) => p.is_active);
		if (filter === 'paused') return projects.filter((p) => !p.is_active);
		if (filter === 'failed') return projects.filter((p) => p.lastBackup?.status === 'failed');
		return projects;
	});

	const totalDisk = $derived(projects.reduce((s, p) => s + (p.totalSizeBytes || 0), 0));
	const recentFailures = $derived(projects.filter((p) => p.lastBackup?.status === 'failed').length);

	function projectColorClass(id: number): string {
		return PROJECT_COLORS[id % PROJECT_COLORS.length];
	}
	function projectInitial(name: string): string {
		return name.charAt(0).toUpperCase();
	}
	function lastBackupClass(status: string | undefined): 'ok' | 'warn' | 'err' | 'none' {
		if (!status) return 'none';
		if (status === 'success') return 'ok';
		if (status === 'partial') return 'warn';
		if (status === 'failed') return 'err';
		return 'none';
	}
	function lastBackupLabel(status: string | undefined): string {
		if (status === 'success') return i18n.t('status.success');
		if (status === 'partial') return i18n.t('status.partial');
		if (status === 'failed') return i18n.t('status.failed');
		if (status === 'running') return i18n.t('status.running');
		return i18n.t('projects.card.no_backup');
	}

	function humanCron(cron: string | undefined): string {
		if (!cron) return '—';
		const m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
		if (m) {
			const h = m[2].padStart(2, '0');
			return i18n.t('projects.row.daily_at', { h, m: m[1].padStart(2, '0') });
		}
		const w = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\d)$/);
		if (w) {
			const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
			return i18n.t('projects.row.weekly_at', {
				day: days[Number(w[3])] ?? w[3],
				h: w[2].padStart(2, '0'),
				m: w[1].padStart(2, '0'),
			});
		}
		const mo = cron.match(/^(\d+)\s+(\d+)\s+(\d+)\s+\*\s+\*$/);
		if (mo) {
			return i18n.t('projects.row.monthly_at', {
				day: mo[3],
				h: mo[2].padStart(2, '0'),
				m: mo[1].padStart(2, '0'),
			});
		}
		return cron;
	}

	function projectDesc(p: ProjectListItem): string {
		if (p.description && p.description.trim()) return p.description;
		return i18n.t('projects.card.no_description');
	}

	async function load() {
		await Promise.all([
			projectsStore.load(true),
			api.get<TmpStatus>('/dashboard/tmp/status').then((s) => (tmp = s)).catch(() => null),
		]);
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
		<b>{i18n.t('projects.title')}</b>
	</div>
	<div class="topbar-actions">
		<button class="icon-btn" title={i18n.t('common.refresh')} onclick={load}>
			<svg class="icn"><use href="#i-refresh" /></svg>
		</button>
	</div>
</div>

<!-- Hero -->
<div class="hero">
	<div>
		<h1>{i18n.t('projects.title')}</h1>
		<div class="hero-meta">
			<span><b>{projects.length}</b> {i18n.tn('dashboard.hero.projects', projects.length)}</span>
			<span class="sep">·</span>
			<span><b>{formatBytes(totalDisk)}</b> {i18n.t('dashboard.hero.disk')}</span>
			{#if recentFailures > 0}
				<span class="sep">·</span>
				<span class="err">
					<svg class="icn icn-sm"><use href="#i-warning" /></svg>
					<b>{recentFailures}</b> {i18n.tn('projects.hero.failures', recentFailures)}
				</span>
			{/if}
		</div>
	</div>
	<div class="hero-actions">
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

{#if !projectsStore.loaded && projectsStore.loading}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if projects.length === 0}
	<div class="card empty-card">
		<div class="empty-ico"><svg class="icn"><use href="#i-folder" /></svg></div>
		<h2>{i18n.t('projects.empty.title')}</h2>
		<p>{i18n.t('projects.empty.help')}</p>
		<a class="btn primary" href="/projects/new">
			<svg class="icn"><use href="#i-plus" /></svg>
			{i18n.t('projects.empty.cta')}
		</a>
	</div>
{:else}
	<div class="list">
		<div class="list-head">
			<div class="chips">
				<button class="chip" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
					{i18n.t('projects.filter.all')} <span class="count">{counts.all}</span>
				</button>
				<button class="chip" class:active={filter === 'active'} onclick={() => (filter = 'active')}>
					{i18n.t('projects.filter.active')} <span class="count">{counts.active}</span>
				</button>
				<button class="chip" class:active={filter === 'paused'} onclick={() => (filter = 'paused')}>
					{i18n.t('projects.filter.paused')} <span class="count">{counts.paused}</span>
				</button>
				<button class="chip" class:active={filter === 'failed'} onclick={() => (filter = 'failed')}>
					{i18n.t('projects.filter.failed')} <span class="count">{counts.failed}</span>
				</button>
			</div>
			<span class="list-head-info">{i18n.t('projects.sorted')}</span>
		</div>

		{#each filteredProjects as project (project.id)}
			<a class="row" href="/projects/{project.id}">
				<div class="row-mark {projectColorClass(project.id)}">{projectInitial(project.name)}</div>

				<div class="row-id">
					<div class="row-name">
						{project.name}
						{#if project.is_active}
							<span class="status ok"><span class="dot"></span> {i18n.t('projects.card.active')}</span>
						{:else}
							<span class="status paused"><span class="dot"></span> {i18n.t('projects.card.inactive')}</span>
						{/if}
					</div>
					<p class="row-desc">{projectDesc(project)}</p>
					<div class="row-meta">
						<span><svg class="icn icn-sm"><use href="#i-db" /></svg> <b>{project.sourcesCount}</b> {i18n.tn('projects.row.sources', project.sourcesCount)}</span>
						<span class="sep">·</span>
						<span><svg class="icn icn-sm"><use href="#i-clock" /></svg> {humanCron(project.schedule?.cron_expression)}</span>
						<span class="sep">·</span>
						<span><svg class="icn icn-sm"><use href="#i-disk" /></svg> <b>{formatBytes(project.totalSizeBytes)}</b></span>
					</div>
				</div>

				<div class="row-last">
					{#if project.lastBackup}
						<div class="row-last-st {lastBackupClass(project.lastBackup.status)}">
							<span class="dot"></span> {lastBackupLabel(project.lastBackup.status)}
						</div>
						{#if project.lastBackup.size_bytes > 0}
							<div class="row-last-size">{formatBytes(project.lastBackup.size_bytes)}</div>
						{/if}
						<div class="row-last-date">{formatRelative(project.lastBackup.started_at)}</div>
					{:else}
						<div class="row-last-st none"><span class="dot"></span> {i18n.t('projects.card.no_backup')}</div>
					{/if}
				</div>

				<svg class="icn row-chev"><use href="#i-arrow" /></svg>
			</a>
		{/each}

		<a class="row-add" href="/projects/new">
			<div class="row-add-icn"><svg class="icn"><use href="#i-plus" /></svg></div>
			{i18n.t('projects.row.add')}
		</a>
	</div>
{/if}

<style>
	/* Topbar */
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
		background: none; cursor: pointer;
	}
	.icon-btn:hover { background: var(--color-card); color: var(--color-text); border-color: var(--color-border); }

	/* Hero */
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
	.hero-meta .err { color: var(--color-danger); display: inline-flex; align-items: center; gap: 0.35rem; }

	.btn {
		padding: 0.6rem 1rem; border-radius: 8px;
		font-size: 0.84rem; font-weight: 500;
		border: 1px solid var(--color-border); background: var(--color-card);
		color: var(--color-text); display: inline-flex; align-items: center; gap: 0.45rem;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
		text-decoration: none;
	}
	.btn:hover { border-color: var(--color-border-2); background: var(--color-card-2); }
	.btn.primary {
		background: var(--color-accent); color: #1a1208; border-color: var(--color-accent);
		font-weight: 600;
		box-shadow: 0 0 24px rgba(251, 191, 36, 0.18);
	}
	.btn.primary:hover { background: var(--color-accent-2); border-color: var(--color-accent-2); }

	/* Tmp warning */
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

	/* List card */
	.list {
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		overflow: hidden;
	}
	.list-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		background: rgba(0, 0, 0, 0.15);
		flex-wrap: wrap; gap: 0.75rem;
	}
	.chips { display: flex; gap: 0.35rem; }
	.chip {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.4rem 0.85rem; border-radius: 999px;
		font-size: 0.78rem; color: var(--color-text-dim);
		border: 1px solid transparent; transition: all 0.12s;
		background: none; cursor: pointer; font-family: inherit;
	}
	.chip:hover { color: var(--color-text); background: rgba(255,255,255,0.04); }
	.chip.active {
		background: rgba(251, 191, 36, 0.08);
		border-color: rgba(251, 191, 36, 0.25);
		color: var(--color-accent); font-weight: 500;
	}
	.chip .count { font-family: 'Geist Mono', monospace; font-size: 0.7rem; opacity: 0.7; }
	.chip.active .count { opacity: 1; }
	.list-head-info {
		font-size: 0.74rem; color: var(--color-text-dim);
		font-family: 'Geist Mono', monospace;
	}

	/* Row */
	.row {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) 200px 18px;
		gap: 1.5rem;
		align-items: center;
		padding: 1.35rem 1.5rem;
		cursor: pointer;
		transition: background 0.12s;
		text-decoration: none;
		color: inherit;
		border-top: 1px solid var(--color-border);
	}
	.list .row:first-of-type { border-top: none; }
	.row:hover { background: rgba(251, 191, 36, 0.025); }
	.row:hover .row-chev { color: var(--color-accent); transform: translateX(3px); }

	.row-mark {
		width: 48px; height: 48px; border-radius: 11px;
		background: var(--color-card-2); border: 1px solid var(--color-border-2);
		display: flex; align-items: center; justify-content: center;
		font-family: 'Geist Mono', monospace; font-weight: 700;
		font-size: 1.15rem; flex-shrink: 0;
	}
	.row-mark.wp { color: var(--color-accent); border-color: rgba(251, 191, 36, 0.3); background: linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02)); }
	.row-mark.cyan { color: var(--color-cyan); border-color: rgba(34, 211, 238, 0.3); background: linear-gradient(135deg, rgba(34,211,238,0.08), rgba(34,211,238,0.02)); }
	.row-mark.violet { color: var(--color-violet); border-color: rgba(167, 139, 250, 0.3); background: linear-gradient(135deg, rgba(167,139,250,0.08), rgba(167,139,250,0.02)); }
	.row-mark.lime { color: var(--color-success); border-color: rgba(74, 222, 128, 0.3); background: linear-gradient(135deg, rgba(74,222,128,0.08), rgba(74,222,128,0.02)); }
	.row-mark.orange { color: var(--color-warn); border-color: rgba(251, 146, 60, 0.3); background: linear-gradient(135deg, rgba(251,146,60,0.08), rgba(251,146,60,0.02)); }
	.row-mark.pink { color: var(--color-danger); border-color: rgba(248, 113, 113, 0.3); background: linear-gradient(135deg, rgba(248,113,113,0.08), rgba(248,113,113,0.02)); }

	.row-id { min-width: 0; }
	.row-name {
		display: flex; align-items: center; gap: 0.6rem;
		font-size: 1.05rem; font-weight: 600;
		letter-spacing: -0.015em;
		margin-bottom: 0.3rem;
	}
	.status {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.18rem 0.55rem; border-radius: 999px;
		font-size: 0.68rem; font-weight: 500;
	}
	.status.ok { background: rgba(74, 222, 128, 0.1); color: var(--color-success); }
	.status.paused { background: rgba(122, 134, 161, 0.12); color: var(--color-text-dim); }
	.status .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
	.status.ok .dot { box-shadow: 0 0 6px var(--color-success); animation: pulse 2s ease-in-out infinite; }
	@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }

	.row-desc {
		font-size: 0.83rem; color: var(--color-text-dim);
		margin-bottom: 0.55rem;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}

	.row-meta {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.78rem; color: var(--color-text-dim);
		flex-wrap: wrap;
	}
	.row-meta span { display: inline-flex; align-items: center; gap: 0.35rem; }
	.row-meta .icn { color: var(--color-text-dimmer); }
	.row-meta b { color: var(--color-text); font-weight: 500; }
	.row-meta .sep { color: var(--color-text-dimmer); opacity: 0.6; }

	.row-last {
		display: flex; flex-direction: column; gap: 0.3rem;
		text-align: right; align-items: flex-end;
	}
	.row-last-st {
		display: inline-flex; align-items: center; gap: 0.4rem;
		font-size: 0.82rem; font-weight: 600;
	}
	.row-last-st .dot { width: 7px; height: 7px; border-radius: 50%; }
	.row-last-st.ok { color: var(--color-success); }
	.row-last-st.ok .dot { background: var(--color-success); box-shadow: 0 0 8px var(--color-success); }
	.row-last-st.warn { color: var(--color-warn); }
	.row-last-st.warn .dot { background: var(--color-warn); }
	.row-last-st.err { color: var(--color-danger); }
	.row-last-st.err .dot { background: var(--color-danger); }
	.row-last-st.none { color: var(--color-text-dim); }
	.row-last-st.none .dot { background: var(--color-text-dimmer); }
	.row-last-size {
		font-size: 0.78rem; color: var(--color-text);
		font-family: 'Geist Mono', monospace;
	}
	.row-last-date {
		font-size: 0.72rem; color: var(--color-text-dim);
		font-family: 'Geist Mono', monospace;
	}

	.row-chev {
		color: var(--color-text-dimmer); transition: all 0.15s;
		width: 16px; height: 16px;
	}

	.row-add {
		display: flex; align-items: center; gap: 0.75rem;
		padding: 1rem 1.5rem;
		font-size: 0.88rem; color: var(--color-text-dim);
		cursor: pointer; transition: all 0.12s;
		border-top: 1px solid var(--color-border);
		text-decoration: none;
	}
	.row-add:hover { background: rgba(251, 191, 36, 0.04); color: var(--color-accent); }
	.row-add-icn {
		width: 32px; height: 32px; border-radius: 8px;
		background: rgba(251, 191, 36, 0.08);
		color: var(--color-accent);
		display: flex; align-items: center; justify-content: center;
		border: 1px dashed rgba(251, 191, 36, 0.3);
	}

	.empty-card {
		padding: 3.5rem 2rem; text-align: center;
		background: var(--color-card); border: 1px dashed var(--color-border-2);
		border-radius: 12px;
	}
	.empty-ico {
		width: 56px; height: 56px; border-radius: 12px;
		background: var(--color-card-2); color: var(--color-text-dim);
		display: flex; align-items: center; justify-content: center;
		margin: 0 auto 1rem;
	}
	.empty-card h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.4rem; }
	.empty-card p { font-size: 0.85rem; color: var(--color-text-dim); margin-bottom: 1.25rem; }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }
	.icn-sm { width: 12px; height: 12px; }

	@media (max-width: 1180px) {
		.row { grid-template-columns: 52px minmax(0, 1fr) 180px 18px; gap: 1rem; }
	}
	@media (max-width: 760px) {
		.hero { flex-direction: column; align-items: flex-start; }
		.hero-actions { width: 100%; }
		.hero-actions .btn { width: 100%; justify-content: center; }
		.list-head { flex-direction: column; align-items: flex-start; }
		.chips { flex-wrap: wrap; }
		.row {
			grid-template-columns: 48px minmax(0, 1fr) 18px;
			padding: 1rem;
			gap: 0.85rem;
		}
		.row-last { display: none; }
		.tmp-warn { flex-direction: column; align-items: flex-start; }
		.tmp-warn button { width: 100%; text-align: center; }
		.row-meta { font-size: 0.74rem; gap: 0.35rem; }
		.row-name { font-size: 0.98rem; }
	}
</style>
