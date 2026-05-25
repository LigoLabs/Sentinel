<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDateFull, formatDuration, formatDurationMs } from '$lib/utils/date';
	import { formatBytes, formatNumber, backupBasename, backupTypeLabel } from '$lib/utils/format';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';

	interface SourceMeta {
		id: number;
		label: string;
		type: string;
		status: string;
		tables?: { name: string; rowCount: number }[];
		files?: number;
		sizeBytes?: number;
		error?: string;
	}

	interface BackupDetail {
		id: number;
		project_id: number;
		project_name: string;
		type: string;
		status: string;
		started_at: string;
		completed_at: string | null;
		size_bytes: number;
		file_path: string | null;
		error_message: string | null;
		metadata: {
			sources?: SourceMeta[];
			logs?: string[];
			duration?: number;
		};
	}

	interface ProgressData {
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

	let backup = $state<BackupDetail | null>(null);
	let loading = $state(true);
	let restoring = $state(false);
	let rerunning = $state(false);
	let showLogs = $state(false);
	let progress = $state<ProgressData | null>(null);
	let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);

	const projectId = $derived($page.params.id);
	const backupId = $derived($page.params.backupId);

	function isRunning(b: BackupDetail | null): boolean {
		if (!b) return false;
		return b.status === 'running' || (!b.completed_at && b.status !== 'success' && b.status !== 'failed' && b.status !== 'partial');
	}

	function statusClass(status: string | undefined): 'ok' | 'warn' | 'err' | 'running' {
		if (status === 'success') return 'ok';
		if (status === 'partial') return 'warn';
		if (status === 'running') return 'running';
		return 'err';
	}

	function statusLabel(status: string | undefined): string {
		if (status === 'success') return i18n.t('status.success');
		if (status === 'partial') return i18n.t('status.partial');
		if (status === 'running') return i18n.t('status.running');
		return i18n.t('status.failed');
	}

	function sourceTypeIcon(type: string): string {
		if (type.includes('mysql') || type.includes('postgres') || type.includes('turso') || type.includes('sqlite')) return 'mysql';
		return 'sftp';
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
				const p = await api.get<ProgressData>(`/backups/progress/${backup?.project_id || projectId}`);
				if (p.phase === 'done' || p.phase === 'idle') {
					progress = null;
					stopPolling();
					backup = await api.get<BackupDetail>(`/backups/${backupId}`);
					if (p.phase === 'done') {
						toast.success(i18n.t('project.progress.toast', {
							status: localizeStatus(p.status),
							duration: Math.round((p.duration || 0) / 1000),
						}));
					}
				} else {
					progress = p;
				}
			} catch { /* ignore */ }
		}, 800);
	}

	function stopPolling() {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
	}

	// Re-charge la sauvegarde à chaque changement d'URL (navigation entre
	// sauvegardes du même projet par exemple).
	$effect(() => {
		const id = backupId;
		loading = true;
		stopPolling();
		progress = null;
		backup = null;
		(async () => {
			try {
				const fetched = await api.get<BackupDetail>(`/backups/${id}`);
				if (id !== backupId) return;
				backup = fetched;
				if (backup && isRunning(backup)) startPolling();
			} finally {
				loading = false;
			}
		})();
	});

	onDestroy(stopPolling);

	function downloadBackup() {
		window.open(`/api/backups/${backupId}/download`, '_blank');
	}

	async function restoreBackup() {
		if (!confirm(i18n.t('backup.confirm.restore.first'))) return;
		if (!confirm(i18n.t('backup.confirm.restore.second'))) return;
		restoring = true;
		try {
			const result = await api.post<{ success: boolean }>(`/backups/${backupId}/restore`);
			if (result.success) toast.success(i18n.t('backup.restore.success'));
			else toast.error(i18n.t('backup.restore.partial'));
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			restoring = false;
		}
	}

	async function deleteBackup() {
		if (!confirm(i18n.t('backup.confirm.delete'))) return;
		try {
			await api.delete(`/backups/${backupId}`);
			toast.success(i18n.t('backup.delete.success'));
			goto(`/projects/${projectId}`);
		} catch (err) {
			toast.error(translateError(err));
		}
	}

	async function rerunBackup() {
		if (!confirm(i18n.t('backup.confirm.rerun'))) return;
		rerunning = true;
		try {
			await api.post(`/backups/${backupId}/rerun`);
			toast.success(i18n.t('backup.rerun.started'));
			// La relance réutilise la même ligne : on bascule en « running » et on
			// suit la progression sur place (le polling existant rafraîchira la page).
			progress = { phase: 'starting', message: i18n.t('project.progress.starting') };
			if (backup) backup = { ...backup, status: 'running', completed_at: null, error_message: null };
			startPolling();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			rerunning = false;
		}
	}

	const totalTables = $derived.by(() => {
		if (!backup?.metadata?.sources) return 0;
		return backup.metadata.sources.reduce((s, src) => s + (src.tables?.length || 0), 0);
	});
	const totalRows = $derived.by(() => {
		if (!backup?.metadata?.sources) return 0;
		return backup.metadata.sources.reduce((s, src) => s + (src.tables?.reduce((a, t) => a + t.rowCount, 0) || 0), 0);
	});
</script>

<!-- Topbar -->
<div class="topbar">
	<div class="crumbs">
		<a href="/projects/{projectId}" class="back-link"><svg class="icn"><use href="#i-back" /></svg></a>
		<a href="/projects">{i18n.t('projects.title')}</a>
		<span class="sep">/</span>
		{#if backup}
			<a href="/projects/{projectId}">{backup.project_name}</a>
			<span class="sep">/</span>
			<b>{backupBasename(backup.file_path, backup.id)}</b>
		{:else}
			<b>{i18n.t('backup.loading')}</b>
		{/if}
	</div>
</div>

{#if loading}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if backup}
	<!-- Hero -->
	<div class="hero">
		<div class="hero-body">
			<div class="hero-mark {statusClass(backup.status)}">
				<svg class="icn"><use href="#i-archive" /></svg>
			</div>
			<div class="hero-text">
				<div class="hero-title-row">
					<h1>{backupBasename(backup.file_path, backup.id)}</h1>
					<span class="status-pill {statusClass(backup.status)}">
						<span class="dot"></span>
						{statusLabel(backup.status)}
					</span>
				</div>
				<p>
					{i18n.t('backup.subtitle', {
						date: formatDateFull(backup.started_at),
					})}
					— {i18n.t('backup.info.project').toLowerCase()}
					<a href="/projects/{projectId}">
						<b>{backup.project_name}</b>
					</a>
				</p>
			</div>
		</div>
		<div class="hero-actions">
			{#if !isRunning(backup)}
				<button class="btn primary" onclick={rerunBackup} disabled={rerunning}>
					<svg class="icn"><use href="#i-play" /></svg>
					{rerunning ? i18n.t('backup.actions.rerunning') : i18n.t('backup.actions.rerun')}
				</button>
			{/if}
			{#if !isRunning(backup) && backup.file_path}
				<button class="btn" onclick={downloadBackup}>
					<svg class="icn"><use href="#i-download" /></svg>
					{i18n.t('backup.actions.download')}
				</button>
				<button class="btn warn" onclick={restoreBackup} disabled={restoring}>
					<svg class="icn"><use href="#i-rotate" /></svg>
					{restoring ? i18n.t('backup.actions.restoring') : i18n.t('backup.actions.restore')}
				</button>
			{/if}
			<button class="btn danger" onclick={deleteBackup}>
				<svg class="icn"><use href="#i-trash" /></svg>
				{i18n.t('backup.actions.delete')}
			</button>
		</div>
	</div>

	<!-- Progress (running) -->
	{#if progress && progress.phase !== 'idle'}
		<div class="progress-card">
			<div class="progress-head">
				<div class="spinner"></div>
				<span>{progress.message || i18n.t('project.progress.default')}</span>
			</div>
			{#if progress.sourceLabel}
				<p class="progress-source">
					{i18n.t('project.progress.source_label')} <span>{progress.sourceLabel}</span>
				</p>
			{/if}
			{#if progress.phase === 'storage' && progress.totalFiles && progress.totalFiles > 0}
				{@const pct = Math.round((progress.downloadedFiles || 0) / progress.totalFiles * 100)}
				<div class="progress-bar-wrap">
					<div class="progress-bar-info">
						<span>{i18n.t('project.progress.files_progress', { done: progress.downloadedFiles || 0, total: progress.totalFiles })}</span>
						<span>{pct}%{progress.downloadedBytes ? ` — ${formatBytes(progress.downloadedBytes)}` : ''}</span>
					</div>
					<div class="progress-bar"><div class="fill" style="width: {pct}%"></div></div>
					{#if progress.currentFile}
						<p class="progress-file" title={progress.currentFile}>{progress.currentFile}</p>
					{/if}
				</div>
			{:else if progress.phase === 'database'}
				<div class="progress-bar-wrap">
					<p class="progress-file">{i18n.t('project.progress.dumping')}</p>
					<div class="progress-bar"><div class="fill pulse" style="width: 100%"></div></div>
				</div>
			{:else if progress.phase === 'compressing'}
				<div class="progress-bar-wrap">
					<p class="progress-file">{i18n.t('project.progress.compressing')}</p>
					<div class="progress-bar"><div class="fill pulse warn" style="width: 100%"></div></div>
				</div>
			{/if}
		</div>
	{:else if isRunning(backup)}
		<div class="progress-card">
			<div class="progress-head">
				<div class="spinner"></div>
				<span>{i18n.t('backup.running')}</span>
			</div>
		</div>
	{/if}

	<!-- 4 KPI cards -->
	<div class="kpis">
		<div class="kpi">
			<div class="kpi-label">{i18n.t('backup.info.project')}</div>
			<div class="kpi-val"><a href="/projects/{projectId}">{backup.project_name}</a></div>
		</div>
		<div class="kpi">
			<div class="kpi-label">{i18n.t('backup.info.type')}</div>
			<div class="kpi-val"><span class="tag" class:monthly={backup.type === 'monthly'} class:manual={backup.type === 'manual'}>{backupTypeLabel(backup.type)}</span></div>
		</div>
		<div class="kpi">
			<div class="kpi-label">{i18n.t('backup.info.size')}</div>
			<div class="kpi-val">{formatBytes(backup.size_bytes)}</div>
		</div>
		<div class="kpi">
			<div class="kpi-label">{i18n.t('backup.info.duration')}</div>
			<div class="kpi-val mono">
				{#if backup.metadata?.duration}
					{formatDurationMs(backup.metadata.duration)}
				{:else}
					{formatDuration(backup.started_at, backup.completed_at)}
				{/if}
			</div>
		</div>
	</div>

	<!-- Timeline + file path -->
	<div class="timeline-card">
		<div class="timeline-item">
			<label>{i18n.t('backup.info.started')}</label>
			<span>{formatDateFull(backup.started_at)}</span>
		</div>
		{#if backup.completed_at}
			<div class="timeline-item">
				<label>{i18n.t('backup.info.finished')}</label>
				<span>{formatDateFull(backup.completed_at)}</span>
			</div>
		{/if}
		{#if backup.file_path}
			<div class="timeline-item" style="margin-left: auto;">
				<label>{i18n.t('backup.info.file_path')}</label>
				<span class="dim">{backup.file_path}</span>
			</div>
		{/if}
	</div>

	<!-- Error banner -->
	{#if backup.error_message}
		<div class="err-banner">
			<svg class="icn"><use href="#i-warning" /></svg>
			<div>
				<strong>{i18n.t('backup.error.title')}</strong>
				{backup.error_message}
			</div>
		</div>
	{/if}

	<!-- Sources sauvegardées -->
	{#if backup.metadata?.sources && backup.metadata.sources.length > 0}
		<div class="card">
			<div class="card-head">
				<div class="card-title">
					{i18n.t('backup.sources.title')}
					<span class="count">{backup.metadata.sources.length}</span>
				</div>
			</div>
			<div class="card-body flush">
				{#each backup.metadata.sources as source (source.id)}
					<div class="src-block">
						<div class="src-head">
							<div class="src-mark {sourceTypeIcon(source.type)}">
								{source.type.charAt(0).toUpperCase()}{source.type.charAt(1) ?? ''}
							</div>
							<span class="src-name">{source.label}</span>
							<span class="src-type">{source.type}</span>
							<span class="src-status">
								<span class="status-pill {statusClass(source.status)}">
									<span class="dot"></span>
									{statusLabel(source.status)}
								</span>
							</span>
						</div>

						{#if source.tables && source.tables.length > 0}
							<div class="src-tables">
								<table>
									<thead>
										<tr>
											<th>{i18n.t('backup.sources.table.col_name')}</th>
											<th class="right">{i18n.t('backup.sources.table.col_rows')}</th>
										</tr>
									</thead>
									<tbody>
										{#each source.tables as table (table.name)}
											<tr>
												<td class="col-name">{table.name}</td>
												<td class="right col-rows">{formatNumber(table.rowCount)}</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr>
											<td>{i18n.tn('backup.sources.tables_total', source.tables.length)}</td>
											<td class="right">{i18n.t('backup.sources.rows_total', { n: formatNumber(source.tables.reduce((a, t) => a + t.rowCount, 0)) })}</td>
										</tr>
									</tfoot>
								</table>
							</div>
						{/if}

						{#if source.files !== undefined}
							<div class="src-files">
								<svg class="icn"><use href="#i-folder" /></svg>
								<span>{i18n.tn('backup.sources.files', source.files, { n: formatNumber(source.files) })}</span>
								{#if source.sizeBytes}
									<span class="sep">·</span>
									<span><b>{formatBytes(source.sizeBytes)}</b></span>
								{/if}
							</div>
						{/if}

						{#if source.error}
							<div class="src-error">{source.error}</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Logs collapsible -->
	{#if backup.metadata?.logs && backup.metadata.logs.length > 0}
		<div class="logs-card" class:open={showLogs}>
			<button class="logs-head" onclick={() => (showLogs = !showLogs)}>
				<div class="card-title">
					{i18n.t('backup.logs.title')}
					<span class="count">{i18n.t('backup.logs.lines_count', { n: backup.metadata.logs.length })}</span>
				</div>
				<svg class="icn chevron"><use href="#i-chevron-down" /></svg>
			</button>
			{#if showLogs}
				<div class="logs-body">
					<pre>{backup.metadata.logs.join('\n')}</pre>
				</div>
			{/if}
		</div>
	{/if}
{:else}
	<div class="card empty-card">
		<p>{i18n.t('backup.not_found')}</p>
	</div>
{/if}

<style>
	.topbar {
		display: flex; justify-content: space-between; align-items: center;
		padding-bottom: 1.25rem; margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	.crumbs { display: flex; align-items: center; gap: 0.55rem; font-size: 0.82rem; color: var(--color-text-dim); min-width: 0; }
	.crumbs a:hover { color: var(--color-text); }
	.crumbs b { color: var(--color-text); font-weight: 500; font-family: 'Geist Mono', monospace; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; }
	.crumbs .sep { opacity: 0.4; }
	.back-link { display: inline-flex; }

	.hero {
		display: flex; justify-content: space-between; align-items: flex-end;
		padding: 1.5rem 0 1.75rem; gap: 1.5rem; flex-wrap: wrap;
	}
	.hero-body { flex: 1; min-width: 0; display: flex; gap: 1rem; align-items: flex-start; }
	.hero-mark {
		width: 56px; height: 56px; border-radius: 12px;
		background: linear-gradient(135deg, rgba(74, 222, 128, 0.1), rgba(74, 222, 128, 0.02));
		border: 1px solid rgba(74, 222, 128, 0.25);
		display: flex; align-items: center; justify-content: center;
		color: var(--color-success); flex-shrink: 0;
	}
	.hero-mark.warn { background: linear-gradient(135deg, rgba(251, 146, 60, 0.1), rgba(251, 146, 60, 0.02)); border-color: rgba(251, 146, 60, 0.25); color: var(--color-warn); }
	.hero-mark.err { background: linear-gradient(135deg, rgba(248, 113, 113, 0.1), rgba(248, 113, 113, 0.02)); border-color: rgba(248, 113, 113, 0.25); color: var(--color-danger); }
	.hero-mark.running { background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(251, 191, 36, 0.02)); border-color: rgba(251, 191, 36, 0.25); color: var(--color-accent); }
	.hero-mark .icn { width: 26px; height: 26px; }

	.hero-text { min-width: 0; }
	.hero-title-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
	.hero-text h1 {
		font-size: 1.4rem; font-weight: 600; letter-spacing: -0.025em;
		font-family: 'Geist Mono', monospace; word-break: break-all;
	}
	.hero-text p { margin-top: 0.3rem; font-size: 0.88rem; color: var(--color-text-dim); }
	.hero-text p a { color: var(--color-text-dim); }
	.hero-text p a b { color: var(--color-text); font-weight: 500; }
	.hero-text p a:hover b { color: var(--color-accent); }

	.status-pill {
		display: inline-flex; align-items: center; gap: 0.4rem;
		padding: 0.2rem 0.6rem; border-radius: 999px;
		font-size: 0.72rem; font-weight: 500;
		flex-shrink: 0;
	}
	.status-pill.ok { background: rgba(74, 222, 128, 0.08); border: 1px solid rgba(74, 222, 128, 0.25); color: var(--color-success); }
	.status-pill.warn { background: rgba(251, 146, 60, 0.08); border: 1px solid rgba(251, 146, 60, 0.25); color: var(--color-warn); }
	.status-pill.err { background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.25); color: var(--color-danger); }
	.status-pill.running { background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.25); color: var(--color-accent); }
	.status-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }

	.hero-actions { display: flex; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; }

	.btn {
		padding: 0.6rem 1rem; border-radius: 8px;
		font-size: 0.84rem; font-weight: 500;
		border: 1px solid var(--color-border); background: var(--color-card);
		color: var(--color-text); display: inline-flex; align-items: center; gap: 0.45rem;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.btn:hover { border-color: var(--color-border-2); background: var(--color-card-2); }
	.btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn.primary { background: var(--color-accent); color: #1a1208; border-color: var(--color-accent); font-weight: 600; box-shadow: 0 0 24px rgba(251, 191, 36, 0.18); }
	.btn.primary:hover:not(:disabled) { background: var(--color-accent-2); border-color: var(--color-accent-2); }
	.btn.warn { background: rgba(251, 146, 60, 0.08); border-color: rgba(251, 146, 60, 0.3); color: var(--color-warn); }
	.btn.warn:hover:not(:disabled) { background: var(--color-warn); color: #1a0c04; border-color: var(--color-warn); }
	.btn.danger { background: rgba(248, 113, 113, 0.06); border-color: rgba(248, 113, 113, 0.3); color: var(--color-danger); }
	.btn.danger:hover:not(:disabled) { background: var(--color-danger); color: #1a0808; border-color: var(--color-danger); }

	/* Progress */
	.progress-card {
		padding: 1.1rem 1.25rem; margin-bottom: 1rem;
		background: var(--color-card);
		border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 12px;
	}
	.progress-head {
		display: flex; align-items: center; gap: 0.7rem;
		margin-bottom: 0.85rem;
	}
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
	.progress-bar .fill.pulse { animation: pulse 1.5s ease-in-out infinite; }
	.progress-bar .fill.warn { background: var(--color-warn); }
	@keyframes pulse { 50% { opacity: 0.6; } }
	.progress-file { font-size: 0.74rem; color: var(--color-text-dim); font-family: 'Geist Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* KPIs */
	.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.85rem; margin-bottom: 1.25rem; }
	.kpi { padding: 1rem 1.15rem; background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; }
	.kpi-label { font-size: 0.7rem; font-weight: 600; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: 0.07em; }
	.kpi-val { margin-top: 0.5rem; font-size: 1.35rem; font-weight: 600; letter-spacing: -0.02em; font-feature-settings: 'tnum'; }
	.kpi-val.mono { font-family: 'Geist Mono', monospace; }
	.kpi-val a { color: inherit; transition: color 0.12s; }
	.kpi-val a:hover { color: var(--color-accent); }
	.kpi-val .tag {
		font-size: 0.78rem; padding: 0.2rem 0.6rem;
		background: var(--color-border); color: var(--color-text-dim);
		border-radius: 4px; font-family: 'Geist Mono', monospace;
		font-weight: 500; letter-spacing: 0.02em;
	}
	.kpi-val .tag.monthly { background: rgba(168, 85, 247, 0.12); color: var(--color-purple); }
	.kpi-val .tag.manual { background: rgba(34, 211, 238, 0.12); color: var(--color-cyan); }

	/* Timeline */
	.timeline-card {
		background: var(--color-card); border: 1px solid var(--color-border);
		border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1rem;
		display: flex; align-items: center; gap: 2rem; flex-wrap: wrap;
	}
	.timeline-item { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
	.timeline-item label {
		font-size: 0.7rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.07em;
	}
	.timeline-item span {
		font-size: 0.88rem; color: var(--color-text);
		font-family: 'Geist Mono', monospace;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	}
	.timeline-item span.dim { color: var(--color-text-dim); }

	/* Error banner */
	.err-banner {
		padding: 0.95rem 1.15rem; margin-bottom: 1rem;
		background: rgba(248, 113, 113, 0.06);
		border: 1px solid rgba(248, 113, 113, 0.22);
		border-radius: 10px;
		display: flex; gap: 0.7rem; align-items: flex-start;
	}
	.err-banner > .icn { color: var(--color-danger); flex-shrink: 0; margin-top: 0.15rem; }
	.err-banner div { font-size: 0.85rem; color: var(--color-text); line-height: 1.5; }
	.err-banner div strong { color: var(--color-danger); display: block; margin-bottom: 0.2rem; font-weight: 600; }

	/* Cards */
	.card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
	.card-head { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); }
	.card-title { font-size: 0.95rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; }
	.card-title .count {
		font-size: 0.68rem; padding: 0.12rem 0.5rem;
		background: var(--color-border); color: var(--color-text-dim);
		border-radius: 999px; font-family: 'Geist Mono', monospace; font-weight: 500;
	}
	.card-body { padding: 1.25rem; }
	.card-body.flush { padding: 0; }

	/* Source block */
	.src-block { padding: 1.1rem 1.25rem; border-bottom: 1px solid var(--color-border); }
	.src-block:last-child { border-bottom: none; }
	.src-head { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 0.85rem; flex-wrap: wrap; }
	.src-mark {
		width: 32px; height: 32px; border-radius: 7px;
		font-family: 'Geist Mono', monospace; font-weight: 700; font-size: 0.74rem;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0; text-transform: uppercase;
	}
	.src-mark.mysql { background: rgba(34, 211, 238, 0.12); color: var(--color-cyan); }
	.src-mark.sftp { background: rgba(167, 139, 250, 0.12); color: var(--color-violet); }
	.src-name { font-size: 0.95rem; font-weight: 600; }
	.src-type {
		font-family: 'Geist Mono', monospace; font-size: 0.7rem;
		padding: 0.18rem 0.55rem; background: var(--color-border); color: var(--color-text-dim); border-radius: 4px;
	}
	.src-status { margin-left: auto; }

	.src-tables { background: rgba(0, 0, 0, 0.25); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
	.src-tables table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
	.src-tables th {
		text-align: left; padding: 0.55rem 0.85rem;
		font-size: 0.65rem; font-weight: 600; color: var(--color-text-dim);
		text-transform: uppercase; letter-spacing: 0.08em;
		border-bottom: 1px solid var(--color-border);
	}
	.src-tables th.right { text-align: right; }
	.src-tables td {
		padding: 0.5rem 0.85rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		font-family: 'Geist Mono', monospace;
	}
	.src-tables td.right { text-align: right; font-feature-settings: 'tnum'; }
	.src-tables td.col-name { color: var(--color-text); }
	.src-tables td.col-rows { color: var(--color-text-dim); }
	.src-tables tbody tr:last-child td { border-bottom: none; }
	.src-tables tbody tr:hover td { background: rgba(255, 255, 255, 0.02); }
	.src-tables tfoot td {
		padding: 0.55rem 0.85rem; font-family: 'Geist Mono', monospace;
		font-size: 0.78rem; color: var(--color-text-dim);
		background: rgba(0, 0, 0, 0.2); border-top: 1px solid var(--color-border);
	}
	.src-tables tfoot td.right { text-align: right; color: var(--color-text); font-weight: 600; }

	.src-files {
		padding: 0.85rem 1rem;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--color-border); border-radius: 8px;
		font-size: 0.85rem; color: var(--color-text);
		display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap;
	}
	.src-files > .icn { color: var(--color-violet); }
	.src-files b { font-family: 'Geist Mono', monospace; font-feature-settings: 'tnum'; }
	.src-files .sep { color: var(--color-text-dimmer); }

	.src-error {
		margin-top: 0.85rem; padding: 0.75rem 0.95rem;
		background: rgba(248, 113, 113, 0.06);
		border: 1px solid rgba(248, 113, 113, 0.22);
		border-radius: 8px;
		font-size: 0.82rem; color: var(--color-danger);
		font-family: 'Geist Mono', monospace; line-height: 1.45;
		white-space: pre-wrap; word-break: break-word;
	}

	/* Logs */
	.logs-card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
	.logs-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.95rem 1.25rem; cursor: pointer; transition: background 0.12s;
		width: 100%; background: none; border: none; color: inherit;
		font-family: inherit; text-align: left;
	}
	.logs-head:hover { background: rgba(255, 255, 255, 0.02); }
	.logs-head .chevron { color: var(--color-text-dim); transition: transform 0.15s; }
	.logs-card.open .logs-head .chevron { transform: rotate(180deg); }
	.logs-body {
		padding: 0; max-height: 360px; overflow-y: auto;
		border-top: 1px solid var(--color-border);
		background: var(--color-bg);
	}
	.logs-body pre {
		padding: 1rem 1.25rem;
		font-family: 'Geist Mono', monospace; font-size: 0.78rem;
		line-height: 1.6; color: var(--color-text-dim);
		white-space: pre; overflow-x: auto;
	}

	.empty-card { padding: 3rem 1.5rem; text-align: center; color: var(--color-text-dim); }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }

	@media (max-width: 1100px) {
		.kpis { grid-template-columns: repeat(2, 1fr); }
	}
	@media (max-width: 760px) {
		.hero { flex-direction: column; align-items: flex-start; }
		.hero-actions { width: 100%; flex-wrap: wrap; }
		.hero-actions .btn { flex: 1; justify-content: center; min-width: 120px; }
		.hero-body { width: 100%; }
		.hero-text h1 { font-size: 1.1rem; }
		.crumbs { font-size: 0.78rem; flex-wrap: wrap; }
		.crumbs b { font-size: 0.74rem; overflow-wrap: anywhere; }
		.card-head { padding: 0.85rem 1rem; flex-wrap: wrap; gap: 0.5rem; }
		.card-body { padding: 1rem; }
		.timeline-card { gap: 1rem; padding: 0.85rem 1rem; }
		.timeline-item { min-width: 0; }
		.timeline-item span { font-size: 0.78rem; }
		.kpi { padding: 0.85rem; }
		.kpi-val { font-size: 1.2rem; }
		/* Sources sauvegardées */
		.src-block { padding: 0.95rem 1rem; }
		.src-head { gap: 0.5rem; }
		.src-head .src-name { flex: 1 0 100%; order: -1; }
	}
	@media (max-width: 480px) {
		.kpis { grid-template-columns: 1fr; }
	}
</style>
