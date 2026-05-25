<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import { formatDate, formatRelative, formatDurationMs } from '$lib/utils/date';
	import { formatBytes, formatNumber, backupBasename, backupTypeLabel } from '$lib/utils/format';
	import { parseCron, humanCron } from '$lib/utils/cron';
	import SourceForm from '$lib/components/SourceForm.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import type { TranslationKey } from '$lib/i18n/dict';

	const PROJECT_COLORS = ['wp', 'cyan', 'violet', 'lime', 'orange', 'pink'];

	interface Source {
		id: number;
		type: string;
		label: string;
		hasConfig: boolean;
		created_at?: string;
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
		created_at: string;
		updated_at: string;
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
	let editingSource = $state<EditSourceData | undefined>(undefined);
	let loadingSourceId = $state<number | null>(null);
	let progress = $state<BackupProgressData | null>(null);
	let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);
	let hoveredIdx = $state<number | null>(null);
	let chartFilter = $state<'daily' | 'monthly'>('daily');

	let editCron = $state('');
	let editRetCount = $state(15);
	let editLifetimeEnabled = $state(true);
	let editCronLifetime = $state('0 3 1 * *');

	// Présets de cron (mêmes que « Nouveau projet ») pour remplir le champ en un clic.
	const schedulePresetsDisposable: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.daily_3', value: '0 3 * * *' },
		{ key: 'project.new.cron.preset.daily_midnight', value: '0 0 * * *' },
		{ key: 'project.new.cron.preset.every_6h', value: '0 */6 * * *' },
		{ key: 'project.new.cron.preset.every_12h', value: '0 0,12 * * *' },
		{ key: 'project.new.cron.preset.weekly_sunday', value: '0 3 * * 0' },
		{ key: 'project.new.cron.preset.monthly_1st', value: '0 3 1 * *' },
	];
	const schedulePresetsLifetime: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.monthly_1st', value: '0 3 1 * *' },
		{ key: 'project.new.cron.preset.yearly', value: '0 3 1 1 *' },
	];

	let editingInfo = $state(false);
	let editName = $state('');
	let editDescription = $state('');
	let savingInfo = $state(false);
	let savingSchedule = $state(false);

	let showDeleteConfirm = $state(false);
	let deleteLoading = $state(false);
	let togglingActive = $state(false);

	const projectId = $derived(Number($page.params.id));

	// Onglet actif piloté par ?tab= (comme la page settings)
	type Tab = 'overview' | 'sources' | 'schedule' | 'history' | 'settings';
	const TABS: Tab[] = ['overview', 'sources', 'schedule', 'history', 'settings'];
	const DEFAULT_TAB: Tab = 'overview';
	const activeTab = $derived.by<Tab>(() => {
		const param = $page.url.searchParams.get('tab');
		return param && (TABS as string[]).includes(param) ? (param as Tab) : DEFAULT_TAB;
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

	// Mark color based on project id, same as Sidebar
	const markClass = $derived.by(() => PROJECT_COLORS[projectId % PROJECT_COLORS.length]);
	const markChar = $derived(project?.name.charAt(0).toUpperCase() ?? '?');

	async function loadProject(id: number) {
		// On reset l'état d'édition à chaque changement de projet pour éviter
		// de garder un formulaire ouvert sur l'ancien projet.
		editingInfo = false;
		showSourceForm = false;
		editingSource = undefined;
		try {
			const fetched = await api.get<ProjectDetail>(`/projects/${id}`);
			// On vérifie qu'on est toujours sur le même projet (l'utilisateur peut
			// avoir cliqué sur un autre dans la sidebar entre temps).
			if (id !== projectId) return;
			project = fetched;
			if (project?.schedule) {
				editCron = project.schedule.cron_expression;
				editRetCount = project.schedule.retention_count;
				const cl = project.schedule.cron_lifetime;
				editLifetimeEnabled = !!(cl && cl.trim());
				editCronLifetime = cl?.trim() || '0 3 1 * *';
			}
			if (project) {
				editName = project.name;
				editDescription = project.description ?? '';
			}
		} finally {
			loading = false;
		}
	}

	async function reload() {
		await loadProject(projectId);
	}

	function startEditInfo() {
		if (!project) return;
		editName = project.name;
		editDescription = project.description ?? '';
		editingInfo = true;
	}

	async function saveInfo() {
		if (!editName.trim()) return;
		savingInfo = true;
		try {
			await api.put(`/projects/${projectId}`, {
				name: editName.trim(),
				description: editDescription,
			});
			toast.success(i18n.t('project.info.saved'));
			editingInfo = false;
			projectsStore.invalidate();
			await projectsStore.load(true);
			await reload();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			savingInfo = false;
		}
	}

	async function toggleActive() {
		if (!project || togglingActive) return;
		togglingActive = true;
		try {
			await api.put(`/projects/${projectId}`, { is_active: !project.is_active });
			toast.success(i18n.t('project.info.saved'));
			projectsStore.invalidate();
			await projectsStore.load(true);
			await reload();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			togglingActive = false;
		}
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
						await reload();
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
		savingSchedule = true;
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
			await reload();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			savingSchedule = false;
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
			await reload();
		} catch (err) {
			toast.error(translateError(err));
		}
	}

	async function deleteProject() {
		deleteLoading = true;
		try {
			await api.delete(`/projects/${projectId}`);
			toast.success(i18n.t('project.danger.deleted'));
			projectsStore.invalidate();
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

	function sourceIconClass(type: string): string {
		if (type.includes('mysql') || type.includes('postgres') || type.includes('turso') || type.includes('sqlite')) return 'mysql';
		return 'sftp';
	}

	function statusClass(status: string): 'ok' | 'warn' | 'err' {
		if (status === 'success') return 'ok';
		if (status === 'partial') return 'warn';
		return 'err';
	}

	function statusLabel(status: string): string {
		if (status === 'success') return i18n.t('status.success');
		if (status === 'partial') return i18n.t('status.partial');
		if (status === 'running') return i18n.t('status.running');
		return i18n.t('status.failed');
	}

	// Durée d'une sauvegarde. Les timestamps SQLite sont en UTC sans suffixe Z.
	function backupDurationLabel(b: Backup): string {
		if (!b.completed_at) return '—';
		const start = new Date(b.started_at.endsWith('Z') ? b.started_at : b.started_at + 'Z').getTime();
		const end = new Date(b.completed_at.endsWith('Z') ? b.completed_at : b.completed_at + 'Z').getTime();
		return formatDurationMs(end - start);
	}

	function nextRunFromCron(cron: string, from: Date = new Date()): Date | null {
		const c = parseCron(cron);
		if (!c) return null;
		for (let i = 0; i < 60; i++) {
			const d = new Date(from);
			d.setDate(d.getDate() + i);
			d.setHours(c.hour, c.minute, 0, 0);
			if (d <= from) continue;
			if (c.dom !== '*' && d.getDate() !== c.dom) continue;
			if (c.dow !== '*' && d.getDay() !== c.dow) continue;
			return d;
		}
		return null;
	}

	function relativeFuture(d: Date): string {
		const diff = d.getTime() - Date.now();
		if (diff <= 0) return '—';
		const h = Math.floor(diff / 3600_000);
		const m = Math.floor((diff % 3600_000) / 60_000);
		if (h > 24) {
			const days = Math.floor(h / 24);
			return `${days} j ${h % 24} h`;
		}
		return `${h} h ${String(m).padStart(2, '0')}`;
	}

	// Derived metrics (from backups[])
	const recentBackups = $derived(project?.backups ?? []);
	// Aperçu de l'historique affiché directement dans la vue d'ensemble.
	const RECENT_LIMIT = 5;
	const overviewRecent = $derived(recentBackups.slice(0, RECENT_LIMIT));
	const completedBackups = $derived(recentBackups.filter((b) => b.completed_at && b.status !== 'running'));
	const successRate = $derived.by(() => {
		if (completedBackups.length === 0) return null;
		const ok = completedBackups.filter((b) => b.status === 'success').length;
		return Math.round((ok / completedBackups.length) * 100);
	});
	const avgSize = $derived.by(() => {
		const okBackups = completedBackups.filter((b) => b.size_bytes > 0);
		if (okBackups.length === 0) return 0;
		return okBackups.reduce((s, b) => s + b.size_bytes, 0) / okBackups.length;
	});
	const avgDurationMs = $derived.by(() => {
		const withDur = completedBackups.filter((b) => b.started_at && b.completed_at);
		if (withDur.length === 0) return 0;
		const sum = withDur.reduce((s, b) => {
			const start = b.started_at.endsWith('Z') ? new Date(b.started_at) : new Date(b.started_at + 'Z');
			const end = new Date((b.completed_at ?? '') + (b.completed_at?.endsWith('Z') ? '' : 'Z'));
			return s + (end.getTime() - start.getTime());
		}, 0);
		return sum / withDur.length;
	});
	const nextRun = $derived.by(() => {
		if (!project?.schedule) return null;
		if (!project.is_active || !project.schedule.is_active) return null;
		const candidates: Date[] = [];
		const main = nextRunFromCron(project.schedule.cron_expression);
		if (main) candidates.push(main);
		if (project.schedule.cron_lifetime) {
			const monthly = nextRunFromCron(project.schedule.cron_lifetime);
			if (monthly) candidates.push(monthly);
		}
		if (candidates.length === 0) return null;
		return candidates.reduce((min, d) => (d < min ? d : min));
	});

	// Chart data — daily backup sizes over last 30 days
	interface ChartPoint {
		x: number; // viewBox px (plot 30..730)
		y: number; // viewBox px (plot 20..180)
		bandX: number; // hover hit-band left edge
		bandW: number; // hover hit-band width
		backup: Backup;
	}
	// Filtre du graphe : 'daily' regroupe quotidien + manuel (rétention courte),
	// 'monthly' = archives mensuelles conservées à vie. Par défaut 'daily'.
	const chartSlice = $derived(
		recentBackups
			.filter((b) => (chartFilter === 'monthly' ? b.type === 'monthly' : b.type !== 'monthly'))
			.slice(0, 30),
	);
	const chartMaxSize = $derived(chartSlice.length ? Math.max(...chartSlice.map((b) => b.size_bytes), 0) : 0);
	const chartData = $derived.by<ChartPoint[]>(() => {
		const list = [...chartSlice].reverse();
		if (list.length === 0) return [];
		const maxSize = Math.max(chartMaxSize, 1);
		const baselineY = 180;
		const topY = 20;
		const usableW = 700;
		const startX = 30;
		const single = list.length === 1;
		const stepX = single ? 0 : usableW / (list.length - 1);
		const half = single ? usableW / 2 : stepX / 2;
		return list.map((b, i) => {
			const ratio = b.size_bytes / maxSize;
			const y = baselineY - ratio * (baselineY - topY);
			const x = single ? startX + usableW / 2 : startX + i * stepX;
			return {
				x,
				y: b.size_bytes === 0 || b.status === 'failed' ? baselineY - 2 : y,
				bandX: Math.max(0, x - half),
				bandW: single ? usableW : stepX,
				backup: b,
			};
		});
	});
	const chartPath = $derived.by(() => {
		if (chartData.length === 0) return '';
		return chartData.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
	});
	const chartAreaPath = $derived.by(() => {
		if (chartData.length === 0) return '';
		const line = chartData.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
		const last = chartData[chartData.length - 1];
		const first = chartData[0];
		return `${line} L ${last.x} 200 L ${first.x} 200 Z`;
	});
	const hoveredPoint = $derived(
		hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < chartData.length ? chartData[hoveredIdx] : null,
	);
	// Position horizontale du tooltip (% de la largeur du tracé), bornée pour rester visible.
	const tipLeft = $derived(hoveredPoint ? Math.min(88, Math.max(12, (hoveredPoint.x / 740) * 100)) : 0);

	// Calendar — next 14 days
	interface CalendarDay {
		date: Date;
		dow: string;
		num: string;
		time: string | null;
		special: boolean; // monthly archive
	}
	const calendarDays = $derived.by<CalendarDay[]>(() => {
		if (!project?.schedule) return [];
		const cron = project.schedule.cron_expression;
		const lifetime = project.schedule.cron_lifetime;
		const c = parseCron(cron);
		const cl = lifetime ? parseCron(lifetime) : null;
		const dows = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

		const days: CalendarDay[] = [];
		const now = new Date();
		for (let i = 1; i <= 14; i++) {
			const d = new Date(now);
			d.setDate(d.getDate() + i);
			d.setHours(0, 0, 0, 0);

			let hit = false;
			if (c) {
				if (c.dom === '*' && c.dow === '*') hit = true;
				else if (c.dom !== '*' && d.getDate() === c.dom) hit = true;
				else if (c.dow !== '*' && d.getDay() === c.dow) hit = true;
			}
			let special = false;
			if (cl) {
				if (cl.dom !== '*' && d.getDate() === cl.dom) {
					if (cl.dow === '*' || d.getDay() === cl.dow) special = true;
				}
			}
			if (hit || special) {
				const ref = special ? cl! : c!;
				const time = `${String(ref.hour).padStart(2, '0')}:${String(ref.minute).padStart(2, '0')}`;
				days.push({
					date: d,
					dow: dows[d.getDay()],
					num: String(d.getDate()).padStart(2, '0'),
					time,
					special,
				});
			} else {
				days.push({
					date: d,
					dow: dows[d.getDay()],
					num: String(d.getDate()).padStart(2, '0'),
					time: null,
					special: false,
				});
			}
		}
		return days;
	});

	// Re-charge le projet à chaque changement d'URL (clic sur un autre projet
	// dans la sidebar). $effect se déclenche aussi au mount initial.
	$effect(() => {
		const id = projectId;
		loading = true;
		stopPolling();
		progress = null;
		hoveredIdx = null;
		project = null;
		void loadProject(id);
	});
	onDestroy(stopPolling);
</script>

<!-- Topbar -->
<div class="topbar">
	<div class="crumbs">
		<a href="/projects" class="back-link"><svg class="icn"><use href="#i-back" /></svg></a>
		<a href="/projects">{i18n.t('projects.title')}</a>
		<span class="sep">/</span>
		<b>{project?.name ?? '…'}</b>
	</div>
</div>

{#if loading}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if project}
	<!-- Hero -->
	<div class="hero">
		<div class="hero-body">
			<div class="hero-mark {markClass}">{markChar}</div>
			<div class="hero-text">
				<div class="hero-title-row">
					<h1>{project.name}</h1>
					{#if project.is_active}
						<span class="status-pill ok"><span class="dot"></span> {i18n.t('projects.card.active')}</span>
					{:else}
						<span class="status-pill paused"><span class="dot"></span> {i18n.t('projects.card.inactive')}</span>
					{/if}
					<button class="edit-pencil" title={i18n.t('project.info.edit')} onclick={() => { startEditInfo(); setTab('settings'); }} aria-label={i18n.t('project.info.edit')}>
						<svg class="icn"><use href="#i-pencil" /></svg>
					</button>
				</div>
				<p>
					{#if project.description}
						{project.description}
					{:else}
						<span class="dim">{i18n.t('projects.card.no_description')}</span>
					{/if}
					· {project.sources.length} {i18n.tn('projects.row.sources', project.sources.length)}
					· {formatBytes(project.totalSizeBytes)} {i18n.t('dashboard.hero.disk')}
				</p>
			</div>
		</div>
		<div class="hero-actions">
			<button class="btn primary" onclick={triggerBackup} disabled={triggerLoading}>
				<svg class="icn"><use href="#i-play" /></svg>
				{triggerLoading ? i18n.t('project.run_backup.running') : i18n.t('project.run_backup')}
			</button>
		</div>
	</div>

	<!-- Tabs -->
	<nav class="tabs">
		<button class="tab" class:active={activeTab === 'overview'} onclick={() => setTab('overview')}>
			<svg class="icn"><use href="#i-home" /></svg> {i18n.t('project.tabs.overview')}
		</button>
		<button class="tab" class:active={activeTab === 'sources'} onclick={() => setTab('sources')}>
			<svg class="icn"><use href="#i-db" /></svg> {i18n.t('project.tabs.sources')}
			<span class="count">{project.sources.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'schedule'} onclick={() => setTab('schedule')}>
			<svg class="icn"><use href="#i-clock" /></svg> {i18n.t('project.tabs.schedule')}
		</button>
		<button class="tab" class:active={activeTab === 'history'} onclick={() => setTab('history')}>
			<svg class="icn"><use href="#i-cal" /></svg> {i18n.t('project.tabs.history')}
			<span class="count">{project.backups.length}</span>
		</button>
		<button class="tab" class:active={activeTab === 'settings'} onclick={() => setTab('settings')}>
			<svg class="icn"><use href="#i-cog" /></svg> {i18n.t('project.tabs.settings')}
		</button>
	</nav>

	<!-- Progress -->
	{#if progress && progress.phase !== 'idle'}
		<div class="progress-card">
			<div class="progress-head">
				<div class="spinner"></div>
				<span>{progress.message || i18n.t('project.progress.default')}</span>
			</div>
			{#if progress.sourceLabel}
				<p class="progress-source">{i18n.t('project.progress.source_label')} <span>{progress.sourceLabel}</span></p>
			{/if}
			{#if progress.phase === 'storage' && progress.totalFiles && progress.totalFiles > 0}
				{@const pct = Math.round((progress.downloadedFiles || 0) / progress.totalFiles * 100)}
				<div class="progress-bar-wrap">
					<div class="progress-bar-info">
						<span>{i18n.t('project.progress.files_progress', { done: progress.downloadedFiles || 0, total: progress.totalFiles })}</span>
						<span>{pct}%{progress.downloadedBytes ? ` — ${formatBytes(progress.downloadedBytes)}` : ''}</span>
					</div>
					<div class="progress-bar"><div class="fill" style="width: {pct}%"></div></div>
					{#if progress.currentFile}<p class="progress-file" title={progress.currentFile}>{progress.currentFile}</p>{/if}
				</div>
			{:else if progress.phase === 'database'}
				<div class="progress-bar-wrap">
					<p class="progress-file">{i18n.t('project.progress.dumping')}</p>
					<div class="progress-bar"><div class="fill pulse" style="width:100%"></div></div>
				</div>
			{:else if progress.phase === 'compressing'}
				<div class="progress-bar-wrap">
					<p class="progress-file">{i18n.t('project.progress.compressing')}</p>
					<div class="progress-bar"><div class="fill pulse warn" style="width:100%"></div></div>
				</div>
			{/if}
		</div>
	{/if}

	{#if activeTab === 'overview'}
	<!-- KPIs -->
	<section class="kpis">
		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('project.kpi.success_rate')}
				<small>{i18n.t('project.kpi.last_n', { n: completedBackups.length })}</small>
			</div>
			<div class="kpi-val">
				{#if successRate === null}—{:else}{successRate}<small>%</small>{/if}
			</div>
		</div>
		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('project.kpi.total_size')}
				<small>{i18n.t('project.kpi.total_size_sub', { n: project.backups.length })}</small>
			</div>
			<div class="kpi-val">{project.totalSizeBytes > 0 ? formatBytes(project.totalSizeBytes) : '—'}</div>
		</div>
		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('project.kpi.avg_size')}
				<small>{i18n.t('project.kpi.last_n', { n: completedBackups.length })}</small>
			</div>
			<div class="kpi-val">{avgSize > 0 ? formatBytes(avgSize) : '—'}</div>
		</div>
		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('project.kpi.avg_duration')}
				<small>{i18n.t('project.kpi.last_n', { n: completedBackups.length })}</small>
			</div>
			<div class="kpi-val mono">{avgDurationMs > 0 ? formatDurationMs(avgDurationMs) : '—'}</div>
		</div>
		<div class="kpi">
			<div class="kpi-label">
				{i18n.t('project.kpi.next_run')}
				<small>cron</small>
			</div>
			{#if nextRun}
				<div class="kpi-val">T−{relativeFuture(nextRun)}</div>
				<div class="kpi-foot">{formatDate(nextRun.toISOString())}</div>
			{:else}
				<div class="kpi-val dim">—</div>
				<div class="kpi-foot">{project.is_active ? i18n.t('project.kpi.no_next') : i18n.t('project.kpi.paused')}</div>
			{/if}
		</div>
	</section>

	<!-- Dernières sauvegardes — accès direct à l'historique depuis la vue d'ensemble -->
	{#if recentBackups.length > 0}
		<div class="card">
			<div class="card-head">
				<div class="card-title">
					{i18n.t('project.recent.title')}
					<span class="count">{recentBackups.length}</span>
				</div>
				{#if recentBackups.length > RECENT_LIMIT}
					<button class="card-link" onclick={() => setTab('history')}>
						{i18n.t('common.see_all')} <svg class="icn icn-sm"><use href="#i-arrow" /></svg>
					</button>
				{/if}
			</div>
			<div class="card-body flush">
				<table class="htable">
					<thead><tr>
						<th>{i18n.t('project.history.col.state')}</th>
						<th>{i18n.t('project.history.col.date')}</th>
						<th>{i18n.t('project.history.col.type')}</th>
						<th>{i18n.t('project.history.col.size')}</th>
						<th>{i18n.t('project.history.col.duration')}</th>
						<th></th>
					</tr></thead>
					<tbody>
						{#each overviewRecent as backup (backup.id)}
							<tr onclick={() => goto(`/projects/${projectId}/backups/${backup.id}`)}>
								<td>
									<span class="st {statusClass(backup.status)}"><i></i>{statusLabel(backup.status)}</span>
								</td>
								<td>{formatDate(backup.started_at)}</td>
								<td><span class="tag-type" class:monthly={backup.type === 'monthly'} class:manual={backup.type === 'manual'}>{backupTypeLabel(backup.type)}</span></td>
								<td>{backup.size_bytes > 0 ? formatBytes(backup.size_bytes) : '—'}</td>
								<td class="mono dim">{backupDurationLabel(backup)}</td>
								<td class="arrow"><svg class="icn icn-sm"><use href="#i-arrow" /></svg></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- Big chart -->
	{#if recentBackups.length > 0}
		<div class="card">
			<div class="card-head">
				<div class="card-title">
					{i18n.t('project.chart.title')}
					{#if chartData.length > 0}<small>{i18n.t('project.chart.subtitle', { n: chartData.length })}</small>{/if}
				</div>
				<div class="chart-tools">
					<div class="seg" role="group" aria-label={i18n.t('project.chart.filter.label')}>
						<button type="button" class="seg-btn" class:active={chartFilter === 'daily'} onclick={() => { chartFilter = 'daily'; hoveredIdx = null; }}>
							{i18n.t('project.chart.filter.daily')}
						</button>
						<button type="button" class="seg-btn" class:active={chartFilter === 'monthly'} onclick={() => { chartFilter = 'monthly'; hoveredIdx = null; }}>
							{i18n.t('project.chart.filter.monthly')}
						</button>
					</div>
					<div class="chart-legend">
						<span><i class="line"></i>{i18n.t('project.chart.size')}</span>
						<span><i class="partial"></i>{i18n.t('status.partial').toLowerCase()}</span>
						<span><i class="fail"></i>{i18n.t('status.failed').toLowerCase()}</span>
						<span><i class="monthly"></i>{i18n.t('project.chart.monthly')}</span>
					</div>
				</div>
			</div>
			<div class="card-body">
				{#if chartData.length > 0}
				<div class="chart-wrap">
					<div class="y-axis" aria-hidden="true">
						<span class="v-max">{chartMaxSize > 0 ? formatBytes(chartMaxSize) : '—'}</span>
						<span class="v-zero">0</span>
					</div>
					<div class="plot" onmouseleave={() => (hoveredIdx = null)}>
						<svg class="chart" viewBox="0 0 740 220" preserveAspectRatio="none">
							<line class="grid grid-major" x1="20" y1="20" x2="740" y2="20"/>
							<line class="grid"            x1="20" y1="110" x2="740" y2="110"/>
							<line class="grid grid-major" x1="20" y1="200" x2="740" y2="200"/>
							<path class="area" d={chartAreaPath}/>
							<path class="line" d={chartPath}/>
							{#if hoveredPoint}
								<line class="guide" x1={hoveredPoint.x} y1="12" x2={hoveredPoint.x} y2="200"/>
							{/if}
							{#each chartData as p, i (p.backup.id)}
								{#if p.backup.status === 'failed'}
									<circle class="marker marker-fail" class:active={hoveredIdx === i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 5.5 : 4}/>
								{:else if p.backup.status === 'partial'}
									<circle class="marker marker-partial" class:active={hoveredIdx === i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 5.5 : 4}/>
								{:else if p.backup.type === 'monthly'}
									<circle class="marker marker-monthly" class:active={hoveredIdx === i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 5 : 3.5}/>
								{:else}
									<circle class="marker marker-ok" class:active={hoveredIdx === i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 4.5 : 2.5}/>
								{/if}
							{/each}
							{#each chartData as p, i (p.backup.id)}
								<rect
									class="hit"
									x={p.bandX}
									y="0"
									width={p.bandW}
									height="220"
									role="button"
									tabindex="-1"
									aria-label={formatDate(p.backup.started_at)}
									onmouseenter={() => (hoveredIdx = i)}
									onclick={() => goto(`/projects/${projectId}/backups/${p.backup.id}`)}
								></rect>
							{/each}
						</svg>
						{#if hoveredPoint}
							<div class="chart-tip" style="left:{tipLeft}%">
								<div class="tip-date">{formatDate(hoveredPoint.backup.started_at)}</div>
								<div class="tip-tags">
									<span class="st {statusClass(hoveredPoint.backup.status)}"><i></i>{statusLabel(hoveredPoint.backup.status)}</span>
									<span class="tag-type" class:monthly={hoveredPoint.backup.type === 'monthly'} class:manual={hoveredPoint.backup.type === 'manual'}>{backupTypeLabel(hoveredPoint.backup.type)}</span>
								</div>
								<dl class="tip-grid">
									<dt>{i18n.t('project.history.col.size')}</dt>
									<dd>{hoveredPoint.backup.size_bytes > 0 ? formatBytes(hoveredPoint.backup.size_bytes) : '—'}</dd>
									<dt>{i18n.t('project.history.col.duration')}</dt>
									<dd>{backupDurationLabel(hoveredPoint.backup)}</dd>
								</dl>
							</div>
						{/if}
					</div>
					<div class="x-axis" aria-hidden="true">
						<span>{formatDate(chartData[0].backup.started_at)}</span>
						{#if chartData.length > 1}
							<span>{formatDate(chartData[chartData.length - 1].backup.started_at)}</span>
						{/if}
					</div>
				</div>
				{:else}
					<div class="chart-empty">{i18n.t('project.chart.empty')}</div>
				{/if}
			</div>
		</div>
	{/if}
	{/if}{#if activeTab === 'schedule'}

	<!-- Calendar + schedule edit form -->
	{#if calendarDays.length > 0}
		<div class="card">
			<div class="card-head">
				<div class="card-title">
					{i18n.t('project.calendar.title')}
					<small>{i18n.t('project.calendar.subtitle')}</small>
				</div>
			</div>
			<div class="card-body">
				<div class="cal">
					{#each calendarDays as day}
						<div class="cal-day" class:special={day.special} class:empty={!day.time}>
							{#if day.special}<span class="cbadge">{i18n.t('project.calendar.monthly_badge')}</span>{/if}
							<div class="dow">{day.dow}</div>
							<div class="num">{day.num}</div>
							{#if day.time}
								<span class="cdot"></span>
								<div class="time">{day.time}</div>
							{:else}
								<span class="cdot empty"></span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	{#if project.schedule}
		<div class="card">
			<div class="card-head">
				<div class="card-title">{i18n.t('project.schedule.title')} <small>{i18n.t('project.schedule.subtitle')}</small></div>
			</div>
			<div class="card-body">

				<!-- Sauvegardes temporaires -->
				<div class="sub-card">
					<h4>
						<span class="ico"><svg class="icn"><use href="#i-clock" /></svg></span>
						{i18n.t('project.new.disposable.title')}
					</h4>
					<p class="sub-help">{i18n.t('project.new.disposable.help')}</p>

					<div class="field">
						<label for="ed-cron">{i18n.t('project.new.disposable.cron')}</label>
						<input id="ed-cron" type="text" class="mono" bind:value={editCron} />
						<div class="presets">
							{#each schedulePresetsDisposable as preset}
								<button type="button" class="chip" class:active={editCron === preset.value} onclick={() => (editCron = preset.value)}>
									{i18n.t(preset.key)}
								</button>
							{/each}
						</div>
						<p class="cron-preview"><svg class="icn icn-sm"><use href="#i-clock" /></svg> {humanCron(editCron)}</p>
					</div>

					<div class="field">
						<label for="ed-ret">{i18n.t('project.new.disposable.retention')}</label>
						<div class="field-row">
							<input id="ed-ret" type="number" bind:value={editRetCount} min="1" max="999" />
							<span>{i18n.t('project.new.disposable.retention_unit')}</span>
						</div>
						<p class="field-help">{i18n.t('project.schedule.retention_help', { n: editRetCount })}</p>
					</div>
				</div>

				<!-- Sauvegardes permanentes -->
				<div class="sub-card">
					<h4>
						<span class="ico lifetime"><svg class="icn"><use href="#i-cal" /></svg></span>
						{i18n.t('project.new.lifetime.title')}
					</h4>
					<p class="sub-help">{i18n.t('project.new.lifetime.help')}</p>

					<label class="toggle-line">
						<input type="checkbox" bind:checked={editLifetimeEnabled} />
						<span>{i18n.t('project.new.lifetime.enable')}</span>
					</label>

					{#if editLifetimeEnabled}
						<div class="field">
							<label for="ed-cron-life">{i18n.t('project.new.lifetime.cron')}</label>
							<input id="ed-cron-life" type="text" class="mono" bind:value={editCronLifetime} />
							<div class="presets">
								{#each schedulePresetsLifetime as preset}
									<button type="button" class="chip" class:active={editCronLifetime === preset.value} onclick={() => (editCronLifetime = preset.value)}>
										{i18n.t(preset.key)}
									</button>
								{/each}
							</div>
							<p class="cron-preview"><svg class="icn icn-sm"><use href="#i-clock" /></svg> {humanCron(editCronLifetime)}</p>
						</div>
					{/if}
				</div>

				<div class="actions">
					<button class="btn primary" onclick={saveSchedule} disabled={savingSchedule}>
						{savingSchedule ? i18n.t('project.info.saving') : i18n.t('project.schedule.save')}
					</button>
				</div>
			</div>
		</div>
	{/if}
	{/if}{#if activeTab === 'sources'}

	<!-- Sources only -->
	<div>
		<div class="card">
			<div class="card-head">
				<div class="card-title">{i18n.t('project.sources.title')} <span class="count">{project.sources.length}</span></div>
				<button class="card-link primary" onclick={() => { showSourceForm = !showSourceForm; editingSource = undefined; }}>
					{#if showSourceForm}
						{i18n.t('project.sources.cancel')}
					{:else}
						<svg class="icn"><use href="#i-plus" /></svg> {i18n.t('project.sources.add_short')}
					{/if}
				</button>
			</div>

			{#if showSourceForm}
				<div class="source-form-wrap">
					{#key editingSource?.id}
						<SourceForm
							projectId={projectId}
							editSource={editingSource}
							onCreated={() => { showSourceForm = false; editingSource = undefined; reload(); }}
						/>
					{/key}
				</div>
			{/if}

			{#if project.sources.length === 0 && !showSourceForm}
				<div class="card-body" style="text-align:center;color:var(--color-text-dim);font-size:0.85rem;padding:2rem">
					{i18n.t('project.sources.empty')}
				</div>
			{:else}
				<div class="card-body flush">
					{#each project.sources as source (source.id)}
						<div class="src">
							<div class="src-mark {sourceIconClass(source.type)}">
								{source.type.charAt(0).toUpperCase()}{source.type.charAt(1) ?? ''}
							</div>
							<div class="src-body">
								<strong>{source.label}</strong>
								<span>{sourceTypeLabel(source.type)}{source.created_at ? ` · ${i18n.t('project.sources.added')} ${formatRelative(source.created_at)}` : ''}</span>
							</div>
							<span class="src-type">{source.type}</span>
							<div class="src-actions">
								<button class="row-icon-btn" title={i18n.t('project.sources.edit')} onclick={() => editSource(source.id)} disabled={loadingSourceId === source.id}>
									<svg class="icn icn-sm"><use href="#i-pencil" /></svg>
								</button>
								<button class="row-icon-btn danger" title={i18n.t('project.sources.delete')} onclick={() => deleteSource(source.id)}>
									<svg class="icn icn-sm"><use href="#i-trash" /></svg>
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	{/if}{#if activeTab === 'history'}

	<!-- History table -->
	<div class="card">
		<div class="card-head">
			<div class="card-title">
				{i18n.t('project.history.title')}
				{#if project.backups.length > 0}
					<span class="count">{project.backups.length} · {formatBytes(project.totalSizeBytes)}</span>
				{/if}
			</div>
		</div>

		{#if project.backups.length === 0}
			<div class="card-body" style="text-align:center;color:var(--color-text-dim);font-size:0.85rem;padding:2rem">
				{i18n.t('project.history.empty')}
			</div>
		{:else}
			<div class="card-body flush">
				<table class="htable">
					<thead><tr>
						<th>{i18n.t('project.history.col.state')}</th>
						<th>{i18n.t('project.history.col.date')}</th>
						<th>{i18n.t('project.history.col.type')}</th>
						<th>{i18n.t('project.history.col.size')}</th>
						<th>{i18n.t('project.history.col.duration')}</th>
						<th>{i18n.t('project.history.col.file')}</th>
						<th></th>
					</tr></thead>
					<tbody>
						{#each project.backups as backup (backup.id)}
							<tr onclick={() => goto(`/projects/${projectId}/backups/${backup.id}`)}>
								<td>
									<span class="st {statusClass(backup.status)}"><i></i>{statusLabel(backup.status)}</span>
								</td>
								<td>{formatDate(backup.started_at)}</td>
								<td><span class="tag-type" class:monthly={backup.type === 'monthly'} class:manual={backup.type === 'manual'}>{backupTypeLabel(backup.type)}</span></td>
								<td>{backup.size_bytes > 0 ? formatBytes(backup.size_bytes) : '—'}</td>
								<td class="mono dim">{backupDurationLabel(backup)}</td>
								<td class="mono">{backup.file_path ? backupBasename(backup.file_path, backup.id) : '—'}</td>
								<td class="arrow"><svg class="icn icn-sm"><use href="#i-arrow" /></svg></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
	{/if}{#if activeTab === 'settings'}

	<!-- Informations -->
	<div class="card">
		<div class="card-head">
			<div class="card-title">{i18n.t('project.info.title')}</div>
			<button class="card-link" onclick={() => editingInfo ? (editingInfo = false) : startEditInfo()}>
				<svg class="icn"><use href="#i-pencil" /></svg> {editingInfo ? i18n.t('project.info.cancel') : i18n.t('project.info.edit')}
			</button>
		</div>

		<div class="card-body flush info-card">
			<div class="info-blk">
				<div class="info-blk-label">{i18n.t('project.info.description')}</div>
				{#if editingInfo}
					<div class="field" style="margin-bottom:0">
						<label for="ed-name">{i18n.t('project.info.name')}</label>
						<input id="ed-name" type="text" bind:value={editName} />
					</div>
					<div class="field" style="margin-top:0.85rem;margin-bottom:0">
						<label for="ed-desc">{i18n.t('project.info.description')}</label>
						<textarea id="ed-desc" rows="3" bind:value={editDescription} placeholder={i18n.t('project.info.description_placeholder')}></textarea>
					</div>
					<div class="actions">
						<button class="btn primary" onclick={saveInfo} disabled={savingInfo || !editName.trim()}>
							{savingInfo ? i18n.t('project.info.saving') : i18n.t('project.info.save')}
						</button>
						<button class="btn ghost" onclick={() => (editingInfo = false)}>{i18n.t('common.cancel')}</button>
					</div>
				{:else if project.description}
					<p class="info-desc">{project.description}</p>
				{:else}
					<p class="info-desc empty">{i18n.t('project.info.description_empty')}</p>
				{/if}
			</div>

			<div class="info-blk">
				<div class="info-blk-label">{i18n.t('project.info.active_label')}</div>
				<div class="toggle-row">
					<button class="toggle" class:off={!project.is_active} onclick={toggleActive} disabled={togglingActive} title={i18n.t('project.info.toggle_help')}>
						<span class="toggle-sw"></span>
						<span class="toggle-label">{project.is_active ? i18n.t('projects.card.active') : i18n.t('projects.card.inactive')}</span>
					</button>
					<span class="toggle-help">{i18n.t('project.info.active_help')}</span>
				</div>
			</div>

			<div class="info-blk">
				<div class="info-blk-label">{i18n.t('project.info.metadata')}</div>
				<dl class="info-meta">
					<div><dt>{i18n.t('project.info.meta.id')}</dt><dd>#{project.id}</dd></div>
					<div><dt>{i18n.t('project.info.meta.created')}</dt><dd>{formatDate(project.created_at)} <small>{formatRelative(project.created_at)}</small></dd></div>
					<div><dt>{i18n.t('project.info.meta.updated')}</dt><dd>{formatDate(project.updated_at)} <small>{formatRelative(project.updated_at)}</small></dd></div>
				</dl>
			</div>
		</div>
	</div>

	<!-- Danger zone -->
	<div class="danger">
		<div class="left">
			<strong>{i18n.t('project.danger.title')}</strong>
			<p>{i18n.t('project.danger.description')}</p>
		</div>
		<button class="btn-danger" onclick={() => (showDeleteConfirm = true)}>
			<svg class="icn"><use href="#i-trash" /></svg>
			{i18n.t('project.danger.delete')}
		</button>
	</div>
	{/if}

	{#if showDeleteConfirm}
		<div class="modal-overlay" onclick={() => (showDeleteConfirm = false)} role="presentation">
			<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
				<h3>{i18n.t('project.danger.confirm.title')}</h3>
				<p>{@html i18n.t('project.danger.confirm.intro', { name: `<strong style="color:var(--color-text)">${project.name}</strong>` })}</p>
				<ul>
					<li>{i18n.tn('project.danger.confirm.backups', project.backups.length)}</li>
					<li>{i18n.tn('project.danger.confirm.sources', project.sources.length)}</li>
					<li>{i18n.t('project.danger.confirm.schedule')}</li>
				</ul>
				<p class="warning">{i18n.t('project.danger.confirm.warning')}</p>
				<div class="modal-actions">
					<button class="btn ghost" onclick={() => (showDeleteConfirm = false)}>{i18n.t('project.danger.confirm.cancel')}</button>
					<button class="btn danger-btn" onclick={deleteProject} disabled={deleteLoading}>
						{deleteLoading ? i18n.t('project.danger.confirm.submitting') : i18n.t('project.danger.confirm.submit')}
					</button>
				</div>
			</div>
		</div>
	{/if}
{:else}
	<div class="py-20 text-center text-text-dim">{i18n.t('project.not_found')}</div>
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
	.back-link { display: inline-flex; }

	/* Hero */
	.hero {
		display: flex; justify-content: space-between; align-items: flex-end;
		padding: 1.5rem 0 1.75rem; gap: 1.5rem; flex-wrap: wrap;
	}
	.hero-body { flex: 1; min-width: 0; display: flex; gap: 1rem; align-items: flex-start; }
	.hero-mark {
		width: 56px; height: 56px; border-radius: 12px;
		background: var(--color-card-2); border: 1px solid var(--color-border-2);
		display: flex; align-items: center; justify-content: center;
		font-family: 'Geist Mono', monospace; font-weight: 700; font-size: 1.35rem;
		flex-shrink: 0;
	}
	.hero-mark.wp { color: var(--color-accent); border-color: rgba(251,191,36,0.35); background: linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.02)); box-shadow: 0 0 32px rgba(251,191,36,0.08); }
	.hero-mark.cyan { color: var(--color-cyan); border-color: rgba(34,211,238,0.35); background: linear-gradient(135deg, rgba(34,211,238,0.1), rgba(34,211,238,0.02)); }
	.hero-mark.violet { color: var(--color-violet); border-color: rgba(167,139,250,0.35); background: linear-gradient(135deg, rgba(167,139,250,0.1), rgba(167,139,250,0.02)); }
	.hero-mark.lime { color: var(--color-success); border-color: rgba(74,222,128,0.35); background: linear-gradient(135deg, rgba(74,222,128,0.1), rgba(74,222,128,0.02)); }
	.hero-mark.orange { color: var(--color-warn); border-color: rgba(251,146,60,0.35); background: linear-gradient(135deg, rgba(251,146,60,0.1), rgba(251,146,60,0.02)); }
	.hero-mark.pink { color: var(--color-danger); border-color: rgba(248,113,113,0.35); background: linear-gradient(135deg, rgba(248,113,113,0.1), rgba(248,113,113,0.02)); }

	.hero-text { flex: 1; min-width: 0; }
	.hero-title-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
	.hero-text h1 { font-size: 1.55rem; font-weight: 600; letter-spacing: -0.025em; }
	.hero-text p { margin-top: 0.4rem; font-size: 0.88rem; color: var(--color-text-dim); }
	.hero-text p .dim { color: var(--color-text-dimmer); font-style: italic; }

	.status-pill {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.2rem 0.6rem; border-radius: 999px;
		font-size: 0.72rem; font-weight: 500;
	}
	.status-pill.ok { background: rgba(74, 222, 128, 0.08); border: 1px solid rgba(74, 222, 128, 0.25); color: var(--color-success); }
	.status-pill.paused { background: rgba(122,134,161,0.12); border: 1px solid rgba(122,134,161,0.25); color: var(--color-text-dim); }
	.status-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
	.status-pill.ok .dot { box-shadow: 0 0 8px var(--color-success); animation: pulse 2s ease-in-out infinite; }
	@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(1.25); } }

	.edit-pencil {
		color: var(--color-text-dimmer); padding: 0.3rem;
		border-radius: 4px; transition: all 0.12s;
		background: none; border: none; cursor: pointer;
	}
	.edit-pencil:hover { color: var(--color-accent); background: rgba(251, 191, 36, 0.08); }

	.hero-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }

	.btn {
		padding: 0.6rem 1rem; border-radius: 8px;
		font-size: 0.84rem; font-weight: 500;
		border: 1px solid var(--color-border); background: var(--color-card);
		color: var(--color-text); display: inline-flex; align-items: center; gap: 0.45rem;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.btn:hover:not(:disabled) { border-color: var(--color-border-2); background: var(--color-card-2); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn.primary { background: var(--color-accent); color: #1a1208; border-color: var(--color-accent); font-weight: 600; box-shadow: 0 0 24px rgba(251, 191, 36, 0.18); }
	.btn.primary:hover:not(:disabled) { background: var(--color-accent-2); border-color: var(--color-accent-2); }
	.btn.ghost { background: transparent; border-color: transparent; color: var(--color-text-dim); }
	.btn.ghost:hover { background: var(--color-card); color: var(--color-text); border-color: var(--color-border); }

	/* Tabs */
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
		text-decoration: none;
		background: none; border-top: none; border-left: none; border-right: none;
		cursor: pointer; font-family: inherit;
	}
	.tab:hover { color: var(--color-text); }
	.tab.active { color: var(--color-text); border-bottom-color: var(--color-accent); font-weight: 500; }
	.tab .count {
		font-size: 0.68rem; padding: 0.1rem 0.4rem;
		background: rgba(255, 255, 255, 0.06); color: var(--color-text-dim);
		border-radius: 999px; font-family: 'Geist Mono', monospace; font-weight: 500;
	}

	/* Progress */
	.progress-card {
		padding: 1.1rem 1.25rem; margin-bottom: 1rem;
		background: var(--color-card);
		border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px;
	}
	.progress-head { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.85rem; }
	.progress-head span { font-size: 0.9rem; font-weight: 500; color: var(--color-text); }
	.spinner {
		width: 18px; height: 18px;
		border: 2px solid rgba(251, 191, 36, 0.25);
		border-top-color: var(--color-accent); border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.progress-source { font-size: 0.78rem; color: var(--color-text-dim); margin-bottom: 0.85rem; }
	.progress-source span { color: var(--color-text); font-family: 'Geist Mono', monospace; }
	.progress-bar-wrap { display: flex; flex-direction: column; gap: 0.4rem; }
	.progress-bar-info { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--color-text-dim); }
	.progress-bar { height: 8px; background: var(--color-bg); border-radius: 999px; overflow: hidden; }
	.progress-bar .fill { height: 100%; background: var(--color-accent); border-radius: 999px; transition: width 0.3s ease-out; }
	.progress-bar .fill.pulse { animation: pulse-bar 1.5s ease-in-out infinite; }
	.progress-bar .fill.warn { background: var(--color-warn); }
	@keyframes pulse-bar { 50% { opacity: 0.6; } }
	.progress-file { font-size: 0.74rem; color: var(--color-text-dim); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* KPIs */
	.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.85rem; margin-bottom: 1.25rem; }
	.kpi { padding: 1.05rem 1.2rem; background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; transition: border-color 0.15s; }
	.kpi:hover { border-color: var(--color-border-2); }
	.kpi-label {
		font-size: 0.7rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.07em;
		display: flex; justify-content: space-between; align-items: center;
	}
	.kpi-label small { font-weight: 500; color: var(--color-text-dimmer); text-transform: none; letter-spacing: 0; font-size: 0.68rem; }
	.kpi-val {
		margin: 0.55rem 0 0.25rem; font-size: 1.7rem; font-weight: 600;
		letter-spacing: -0.025em; font-feature-settings: 'tnum';
		display: flex; align-items: baseline; gap: 0.2rem;
	}
	.kpi-val small { font-size: 0.78rem; color: var(--color-text-dim); font-weight: 500; }
	.kpi-val.mono { font-family: 'Geist Mono', monospace; font-size: 1.45rem; }
	.kpi-val.dim { color: var(--color-text-dimmer); }
	.kpi-foot { font-size: 0.74rem; color: var(--color-text-dim); margin-top: 0.4rem; }

	/* Chart */
	.chart-legend { display: flex; gap: 1rem; font-size: 0.74rem; color: var(--color-text-dim); flex-wrap: wrap; }
	.chart-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 0.35rem; vertical-align: middle; }
	.chart-legend i.line { background: var(--color-accent); height: 2px; width: 16px; border-radius: 0; }
	.chart-legend i.fail { background: var(--color-danger); border-radius: 50%; }
	.chart-legend i.partial { background: var(--color-warn); border-radius: 50%; }
	.chart-legend i.monthly { background: var(--color-purple); border-radius: 50%; }
	.chart-tools { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
	.seg {
		display: inline-flex; gap: 2px; padding: 2px;
		background: var(--color-bg); border: 1px solid var(--color-border);
		border-radius: 8px;
	}
	.seg-btn {
		padding: 0.3rem 0.75rem; border-radius: 6px;
		font-size: 0.76rem; color: var(--color-text-dim);
		background: none; border: none; cursor: pointer;
		font-family: inherit; transition: all 0.12s; white-space: nowrap;
	}
	.seg-btn:hover { color: var(--color-text); }
	.seg-btn.active { background: rgba(251, 191, 36, 0.12); color: var(--color-accent); font-weight: 600; }
	.chart-empty {
		height: 220px; display: flex; align-items: center; justify-content: center;
		color: var(--color-text-dim); font-size: 0.85rem;
	}
	.chart { width: 100%; height: 100%; display: block; }
	.chart .grid { stroke: rgba(255, 255, 255, 0.04); stroke-width: 1; }
	.chart .grid-major { stroke: rgba(255, 255, 255, 0.08); }
	.chart .area { fill: url(#area-fill); }
	.chart .line { fill: none; stroke: var(--color-accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.chart .marker { stroke-width: 2; fill: var(--color-card); }
	.chart .marker-fail { stroke: var(--color-danger); }
	.chart .marker-partial { stroke: var(--color-warn); }
	.chart .marker-monthly { fill: var(--color-purple); stroke: none; }
	.chart .marker-ok { stroke: var(--color-accent); }
	.chart .marker-ok.active { fill: var(--color-accent); }
	.chart .marker.active { stroke-width: 2.5; }
	.chart .guide { stroke: var(--color-text-dim); stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.7; vector-effect: non-scaling-stroke; }
	.chart .hit { fill: transparent; pointer-events: all; cursor: pointer; }

	/* Chart — interactive layout (axes + tooltip) */
	.chart-wrap {
		display: grid;
		grid-template-columns: 46px 1fr;
		grid-template-rows: 220px auto;
		column-gap: 4px;
	}
	.y-axis { grid-column: 1; grid-row: 1; position: relative; }
	.y-axis span {
		position: absolute; right: 2px;
		font-size: 0.66rem; color: var(--color-text-dimmer);
		font-family: 'Geist Mono', monospace; white-space: nowrap;
	}
	.y-axis .v-max { top: 13px; }
	.y-axis .v-zero { top: 171px; }
	.plot { grid-column: 2; grid-row: 1; position: relative; min-width: 0; }
	.x-axis {
		grid-column: 2; grid-row: 2;
		display: flex; justify-content: space-between;
		padding-top: 7px; font-size: 0.66rem;
		color: var(--color-text-dimmer); font-family: 'Geist Mono', monospace;
	}
	.chart-tip {
		position: absolute; top: 4px; transform: translateX(-50%);
		pointer-events: none; z-index: 5; min-width: 152px;
		background: var(--color-card-2);
		border: 1px solid var(--color-border-2); border-radius: 9px;
		padding: 0.55rem 0.7rem;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
	}
	.chart-tip .tip-date {
		font-size: 0.74rem; color: var(--color-text);
		font-family: 'Geist Mono', monospace; margin-bottom: 0.45rem;
	}
	.chart-tip .tip-tags { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
	.chart-tip .tip-grid { display: grid; grid-template-columns: auto auto; gap: 0.2rem 0.7rem; align-items: baseline; }
	.chart-tip .tip-grid dt { font-size: 0.68rem; color: var(--color-text-dim); }
	.chart-tip .tip-grid dd { font-size: 0.74rem; color: var(--color-text); text-align: right; font-family: 'Geist Mono', monospace; }

	/* Calendar */
	.cal { display: grid; grid-template-columns: repeat(14, 1fr); gap: 6px; }
	.cal-day {
		padding: 0.65rem 0.4rem; border-radius: 8px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.04);
		text-align: center; transition: all 0.12s; position: relative;
	}
	.cal-day:hover { background: rgba(251, 191, 36, 0.06); border-color: rgba(251, 191, 36, 0.25); }
	.cal-day.special { background: rgba(168, 85, 247, 0.06); border-color: rgba(168, 85, 247, 0.25); }
	.cal-day.special:hover { background: rgba(168, 85, 247, 0.12); border-color: rgba(168, 85, 247, 0.4); }
	.cal-day.empty { opacity: 0.45; }
	.cal-day .dow {
		font-size: 0.6rem; color: var(--color-text-dimmer);
		text-transform: uppercase; letter-spacing: 0.08em;
		margin-bottom: 0.3rem;
		font-family: 'Geist Mono', monospace;
	}
	.cal-day .num { font-size: 1.05rem; font-weight: 600; color: var(--color-text); font-family: 'Geist Mono', monospace; font-feature-settings: 'tnum'; }
	.cal-day .cdot { display: block; margin: 0.35rem auto 0; width: 5px; height: 5px; border-radius: 50%; background: var(--color-accent); }
	.cal-day .cdot.empty { background: rgba(255, 255, 255, 0.1); }
	.cal-day.special .cdot { background: var(--color-purple); box-shadow: 0 0 8px var(--color-purple); }
	.cal-day .time { font-size: 0.58rem; color: var(--color-text-dimmer); margin-top: 0.3rem; font-family: 'Geist Mono', monospace; }
	.cal-day .cbadge {
		position: absolute; top: -5px; right: -5px;
		font-size: 0.55rem; padding: 0.1rem 0.3rem;
		background: var(--color-purple); color: #fff;
		border-radius: 3px; font-weight: 700;
		font-family: 'Geist Mono', monospace; letter-spacing: 0.05em;
	}

	/* Schedule edit */
	.schedule-edit {
		padding: 1.1rem 1.25rem;
		border-top: 1px solid var(--color-border);
		background: rgba(0, 0, 0, 0.15);
	}

	/* 2-col layout */
	.cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1rem; margin-bottom: 1rem; }

	/* Cards */
	.card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
	.card-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border);
	}
	.card-title { font-size: 0.95rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; }
	.card-title small { font-weight: 400; color: var(--color-text-dim); font-size: 0.78rem; margin-left: 0.4rem; }
	.card-title .count {
		font-size: 0.68rem; padding: 0.12rem 0.5rem;
		background: var(--color-border); color: var(--color-text-dim);
		border-radius: 999px; font-family: 'Geist Mono', monospace; font-weight: 500;
	}
	.card-link {
		display: inline-flex; align-items: center; gap: 0.35rem;
		padding: 0.4rem 0.7rem; border-radius: 6px;
		font-size: 0.78rem; color: var(--color-text-dim);
		border: 1px solid transparent;
		transition: all 0.12s; background: none; cursor: pointer; font-family: inherit;
	}
	.card-link:hover { color: var(--color-text); border-color: var(--color-border); }
	.card-link.primary { color: var(--color-accent); }
	.card-link.primary:hover { color: var(--color-accent-2); border-color: rgba(251, 191, 36, 0.3); background: rgba(251, 191, 36, 0.05); }
	.card-body { padding: 1.25rem; }
	.card-body.flush { padding: 0; }

	/* Sources */
	.source-form-wrap { padding: 1.25rem; border-top: 1px solid var(--color-border); background: rgba(0,0,0,0.15); }
	.src {
		display: grid; grid-template-columns: auto 1fr auto auto;
		gap: 0.85rem; align-items: center;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		transition: background 0.12s;
	}
	.src:hover { background: rgba(255, 255, 255, 0.02); }
	.src:last-child { border-bottom: none; }
	.src-mark {
		width: 34px; height: 34px; border-radius: 8px;
		font-family: 'Geist Mono', monospace; font-size: 0.74rem; font-weight: 700;
		display: flex; align-items: center; justify-content: center;
		text-transform: uppercase;
	}
	.src-mark.mysql { background: rgba(34, 211, 238, 0.12); color: var(--color-cyan); }
	.src-mark.sftp { background: rgba(167, 139, 250, 0.12); color: var(--color-violet); }
	.src-body strong { display: block; font-size: 0.92rem; font-weight: 500; }
	.src-body span { font-size: 0.75rem; color: var(--color-text-dim); }
	.src-type {
		font-family: 'Geist Mono', monospace; font-size: 0.7rem;
		padding: 0.2rem 0.55rem; background: var(--color-border);
		color: var(--color-text-dim); border-radius: 4px;
	}
	.src-actions { display: flex; gap: 0.2rem; }
	.row-icon-btn {
		width: 28px; height: 28px; border-radius: 6px;
		display: flex; align-items: center; justify-content: center;
		color: var(--color-text-dimmer); transition: all 0.12s;
		background: none; border: none; cursor: pointer;
	}
	.row-icon-btn:hover:not(:disabled) { color: var(--color-text); background: rgba(255, 255, 255, 0.06); }
	.row-icon-btn:disabled { opacity: 0.4; cursor: wait; }
	.row-icon-btn.danger:hover:not(:disabled) { color: var(--color-danger); background: rgba(248, 113, 113, 0.08); }

	/* Informations card */
	.info-card { padding: 0; }
	.info-blk { padding: 1.1rem 1.25rem; border-bottom: 1px solid var(--color-border); }
	.info-blk:last-child { border-bottom: none; }
	.info-blk-label {
		font-size: 0.66rem; font-weight: 600;
		letter-spacing: 0.1em; text-transform: uppercase;
		color: var(--color-text-dim); margin-bottom: 0.6rem;
		font-family: 'Geist Mono', monospace;
	}
	.info-desc { font-size: 0.9rem; color: var(--color-text); line-height: 1.55; }
	.info-desc.empty { color: var(--color-text-dimmer); font-style: italic; }

	.toggle-row { display: flex; align-items: center; gap: 0.85rem; flex-wrap: wrap; }
	.toggle {
		display: inline-flex; align-items: center; gap: 0.7rem;
		padding: 0.25rem; border-radius: 999px;
		transition: background 0.15s;
		background: none; border: none; cursor: pointer; font-family: inherit;
	}
	.toggle:hover:not(:disabled) { background: rgba(255, 255, 255, 0.03); }
	.toggle:disabled { opacity: 0.6; cursor: wait; }
	.toggle-sw {
		width: 36px; height: 20px;
		background: rgba(74, 222, 128, 0.2);
		border: 1px solid rgba(74, 222, 128, 0.45);
		border-radius: 999px; position: relative;
		transition: all 0.18s; flex-shrink: 0;
	}
	.toggle-sw::after {
		content: ''; position: absolute;
		top: 1px; left: 16px;
		width: 16px; height: 16px;
		background: var(--color-success); border-radius: 50%;
		box-shadow: 0 0 8px var(--color-success), 0 1px 2px rgba(0,0,0,0.3);
		transition: all 0.18s;
	}
	.toggle.off .toggle-sw { background: var(--color-border); border-color: var(--color-border-2); }
	.toggle.off .toggle-sw::after { left: 1px; background: var(--color-text-dim); box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
	.toggle-label { font-size: 0.92rem; font-weight: 500; color: var(--color-success); }
	.toggle.off .toggle-label { color: var(--color-text-dim); }
	.toggle-help {
		font-size: 0.78rem; color: var(--color-text-dim);
		font-style: italic; flex: 1; min-width: 0;
	}

	.info-meta { display: grid; gap: 0.55rem; }
	.info-meta > div {
		display: grid; grid-template-columns: 110px 1fr;
		gap: 0.85rem; align-items: baseline;
	}
	.info-meta dt { font-size: 0.78rem; color: var(--color-text-dim); }
	.info-meta dd { font-size: 0.84rem; color: var(--color-text); font-family: 'Geist Mono', monospace; }
	.info-meta dd small { color: var(--color-text-dim); font-family: 'Geist', sans-serif; font-style: italic; margin-left: 0.4rem; font-size: 0.78rem; }

	/* Form fields used in inline edit */
	.field { margin-bottom: 1.1rem; }
	.field label {
		display: block; font-size: 0.78rem; font-weight: 500;
		color: var(--color-text); margin-bottom: 0.45rem;
	}
	.field input, .field textarea {
		width: 100%; padding: 0.6rem 0.85rem;
		background: var(--color-bg); color: var(--color-text);
		border: 1px solid var(--color-border); border-radius: 8px;
		font: inherit; transition: border-color 0.12s;
		font-size: 0.88rem;
	}
	.field input:focus, .field textarea:focus {
		outline: none; border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.1);
	}
	.field input.mono { font-family: 'Geist Mono', monospace; font-size: 0.85rem; }
	.field-row { display: flex; align-items: center; gap: 0.7rem; }
	.field-row input { width: 90px; }
	.field-row span { font-size: 0.85rem; color: var(--color-text-dim); }
	.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
	.toggle-line {
		display: flex; align-items: center; gap: 0.6rem;
		cursor: pointer; padding: 0.6rem 0.85rem;
		background: var(--color-bg); border: 1px solid var(--color-border);
		border-radius: 8px;
		font-size: 0.85rem; color: var(--color-text); margin: 1rem 0;
	}
	.toggle-line input { accent-color: var(--color-accent); width: 16px; height: 16px; cursor: pointer; }

	/* Sous-cartes de planification (mêmes repères visuels que « Nouveau projet ») */
	.sub-card {
		padding: 1.1rem 1.2rem;
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		margin-bottom: 1rem;
	}
	.sub-card h4 {
		font-size: 0.9rem; font-weight: 600;
		margin-bottom: 0.3rem;
		display: flex; align-items: center; gap: 0.5rem;
	}
	.sub-card h4 .ico {
		width: 26px; height: 26px; border-radius: 6px;
		display: flex; align-items: center; justify-content: center;
		background: rgba(251, 191, 36, 0.12); color: var(--color-accent);
	}
	.sub-card h4 .ico.lifetime { background: rgba(168, 85, 247, 0.12); color: var(--color-purple); }
	.sub-help {
		font-size: 0.78rem; color: var(--color-text-dim);
		line-height: 1.5; margin-bottom: 1rem;
	}
	.field-help { margin-top: 0.4rem; font-size: 0.76rem; color: var(--color-text-dim); }
	.presets { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-top: 0.55rem; }
	.chip {
		padding: 0.35rem 0.7rem; border-radius: 999px;
		font-size: 0.74rem; font-weight: 500;
		background: var(--color-card); color: var(--color-text-dim);
		border: 1px solid var(--color-border);
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.chip:hover { color: var(--color-text); border-color: var(--color-border-2); }
	.chip.active {
		background: rgba(251, 191, 36, 0.1);
		border-color: rgba(251, 191, 36, 0.35);
		color: var(--color-accent);
	}
	.cron-preview {
		margin-top: 0.6rem;
		display: inline-flex; align-items: center; gap: 0.45rem;
		font-size: 0.82rem; color: var(--color-text);
		background: var(--color-bg); border: 1px solid var(--color-border);
		padding: 0.35rem 0.7rem; border-radius: 6px;
	}
	.cron-preview svg { color: var(--color-accent); }
	.actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-top: 1rem; }

	/* History table */
	.htable { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
	.htable th {
		text-align: left; padding: 0.7rem 1.25rem;
		font-size: 0.65rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.08em;
		border-bottom: 1px solid var(--color-border);
		background: rgba(0, 0, 0, 0.18);
	}
	.htable td { padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); }
	.htable tbody tr { cursor: pointer; transition: background 0.12s; }
	.htable tbody tr:hover { background: rgba(251, 191, 36, 0.025); }
	.htable tbody tr:last-child td { border-bottom: none; }
	.htable td.mono { font-family: 'Geist Mono', monospace; font-size: 0.78rem; }
	.htable td.dim { color: var(--color-text-dim); }
	.htable td.arrow { color: var(--color-text-dimmer); width: 18px; padding-right: 1rem; }
	.htable tbody tr:hover td.arrow { color: var(--color-accent); }

	.st {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.18rem 0.55rem; border-radius: 999px;
		font-size: 0.72rem; font-weight: 500;
	}
	.st i { width: 6px; height: 6px; border-radius: 50%; }
	.st.ok { background: rgba(74, 222, 128, 0.1); color: var(--color-success); }
	.st.ok i { background: var(--color-success); }
	.st.warn { background: rgba(251, 146, 60, 0.1); color: var(--color-warn); }
	.st.warn i { background: var(--color-warn); }
	.st.err { background: rgba(248, 113, 113, 0.1); color: var(--color-danger); }
	.st.err i { background: var(--color-danger); }

	.tag-type {
		font-family: 'Geist Mono', monospace; font-size: 0.68rem;
		padding: 0.15rem 0.5rem; background: var(--color-border);
		color: var(--color-text-dim); border-radius: 4px;
	}
	.tag-type.monthly { background: rgba(168, 85, 247, 0.12); color: var(--color-purple); }
	.tag-type.manual { background: rgba(34, 211, 238, 0.12); color: var(--color-cyan); }

	/* Danger zone */
	.danger {
		border: 1px solid rgba(248, 113, 113, 0.22);
		background: rgba(248, 113, 113, 0.03);
		border-radius: 12px;
		padding: 1.1rem 1.25rem;
		display: flex; justify-content: space-between; align-items: center;
		gap: 1rem; font-size: 0.86rem; color: var(--color-text-dim);
	}
	.danger .left strong { color: var(--color-danger); font-weight: 600; display: block; margin-bottom: 0.2rem; }
	.btn-danger {
		padding: 0.55rem 1.1rem; border-radius: 8px;
		border: 1px solid rgba(248, 113, 113, 0.4); color: var(--color-danger);
		font-size: 0.82rem; font-weight: 500; flex-shrink: 0;
		transition: all 0.12s; background: none; cursor: pointer; font-family: inherit;
		display: inline-flex; align-items: center; gap: 0.4rem;
	}
	.btn-danger:hover { background: var(--color-danger); color: #1a0808; border-color: var(--color-danger); }
	.btn.danger-btn {
		background: var(--color-danger); color: #1a0808; border-color: var(--color-danger);
	}
	.btn.danger-btn:hover:not(:disabled) { background: #fda4a4; border-color: #fda4a4; }

	/* Modal */
	.modal-overlay {
		position: fixed; inset: 0; z-index: 50;
		display: flex; align-items: center; justify-content: center;
		background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px);
		padding: 1rem;
	}
	.modal {
		width: 100%; max-width: 460px;
		background: var(--color-card); border: 1px solid var(--color-border);
		border-radius: 14px; padding: 1.5rem;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
	}
	.modal h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; }
	.modal p { font-size: 0.88rem; color: var(--color-text-dim); margin-bottom: 0.5rem; line-height: 1.5; }
	.modal ul { list-style: none; padding: 0; margin: 0.5rem 0; }
	.modal ul li { font-size: 0.84rem; color: var(--color-text-dim); padding: 0.25rem 0; }
	.modal p.warning { color: var(--color-danger); font-weight: 500; margin: 0.85rem 0; }
	.modal-actions { display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 1.25rem; }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }
	.icn-sm { width: 12px; height: 12px; }

	@media (max-width: 1100px) {
		.kpis { grid-template-columns: repeat(2, 1fr); }
		.cols { grid-template-columns: 1fr; }
		.cal { grid-template-columns: repeat(7, 1fr); }
	}
	@media (max-width: 760px) {
		.hero { flex-direction: column; align-items: flex-start; }
		.hero-actions { width: 100%; flex-wrap: wrap; }
		.hero-actions .btn { flex: 1; justify-content: center; }
		.hero-text h1 { font-size: 1.3rem; }
		.crumbs { font-size: 0.78rem; }
		.crumbs b { font-size: 0.76rem; }
		.card-head { padding: 0.85rem 1rem; flex-wrap: wrap; gap: 0.5rem; }
		.card-body { padding: 1rem; }
		.kpis { grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
		.kpi { padding: 0.85rem; }
		.kpi-val { font-size: 1.35rem; }
		/* Tableau historique scrollable horizontalement sur mobile */
		.card-body.flush { overflow-x: auto; -webkit-overflow-scrolling: touch; }
		.htable { min-width: 600px; }
		.htable th, .htable td { padding: 0.65rem 0.85rem; white-space: nowrap; }
		/* Sources */
		.src { grid-template-columns: auto 1fr auto; gap: 0.6rem; padding: 0.75rem 1rem; }
		.src .src-type { display: none; }
		/* Calendrier — 2 rangées de 7 jours */
		.cal { grid-template-columns: repeat(7, 1fr); }
		.cal-day { padding: 0.5rem 0.3rem; }
		.cal-day .num { font-size: 0.92rem; }
		/* Info card */
		.info-blk { padding: 0.95rem 1rem; }
		.info-meta > div { grid-template-columns: 90px 1fr; gap: 0.5rem; }
		.toggle-row { gap: 0.5rem; }
		.toggle-help { font-size: 0.72rem; }
		/* Danger zone */
		.danger { flex-direction: column; align-items: flex-start; gap: 0.85rem; padding: 1rem; }
		.danger .btn-danger { width: 100%; justify-content: center; }
		/* Schedule edit form */
		.grid-2 { grid-template-columns: 1fr; gap: 0.85rem; }
		/* Modal */
		.modal { padding: 1.25rem; }
	}
	@media (max-width: 480px) {
		.kpis { grid-template-columns: 1fr; }
	}
</style>
