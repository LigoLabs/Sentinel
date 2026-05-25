<script lang="ts">
	import { onMount } from 'svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { formatRelative } from '$lib/utils/date';

	type Filter = 'all' | 'unread' | 'read';
	let filter = $state<Filter>('all');
	let loading = $state(true);

	const unreadCount = $derived(alerts.items.filter((a) => !a.is_read).length);
	const readCount = $derived(alerts.items.length - unreadCount);
	const totalCount = $derived(alerts.items.length);

	const filtered = $derived.by(() => {
		if (filter === 'unread') return alerts.items.filter((a) => !a.is_read);
		if (filter === 'read') return alerts.items.filter((a) => a.is_read);
		return alerts.items;
	});

	function alertIcon(type: string): string {
		return type === 'partial' ? 'i-warning' : 'i-x';
	}
	function alertTagClass(type: string): string {
		return type === 'partial' ? 'partial' : '';
	}
	function alertTagLabel(type: string): string {
		if (type === 'partial') return i18n.t('alerts.type.partial');
		if (type === 'failure') return i18n.t('alerts.type.failure');
		return type;
	}

	onMount(async () => {
		await Promise.all([alerts.loadList(), alerts.refreshCount()]);
		loading = false;
	});
</script>

<!-- Topbar -->
<div class="topbar">
	<div class="crumbs">
		<a href="/">Sentinel</a>
		<span class="sep">/</span>
		<b>{i18n.t('alerts.title')}</b>
	</div>
	<div class="topbar-actions">
		<button class="icon-btn" title={i18n.t('common.refresh')} onclick={() => alerts.loadList()}>
			<svg class="icn"><use href="#i-refresh" /></svg>
		</button>
	</div>
</div>

<!-- Hero -->
<div class="hero">
	<div>
		<h1>{i18n.t('alerts.title')}</h1>
		<div class="hero-meta">
			{#if unreadCount > 0}
				<span class="err"><b>{unreadCount}</b> {i18n.tn('alerts.hero.unread', unreadCount)}</span>
				<span class="sep">·</span>
			{/if}
			<span><b>{totalCount}</b> {i18n.tn('alerts.hero.total', totalCount)}</span>
			<span class="sep">·</span>
			<span>{i18n.t('alerts.hero.help')}</span>
		</div>
	</div>
	{#if unreadCount > 0}
		<div class="hero-actions">
			<button class="btn" onclick={() => alerts.markAllRead()}>
				<svg class="icn"><use href="#i-check" /></svg>
				{i18n.t('alerts.mark_all_read')}
			</button>
		</div>
	{/if}
</div>

{#if loading && alerts.items.length === 0}
	<div class="flex justify-center py-20">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if alerts.items.length === 0}
	<div class="list">
		<div class="empty">
			<div class="empty-ico"><svg class="icn"><use href="#i-check" /></svg></div>
			<h2>{i18n.t('alerts.empty.title')}</h2>
			<p>{i18n.t('alerts.empty.help')}</p>
		</div>
	</div>
{:else}
	<div class="list">
		<div class="list-head">
			<div class="chips">
				<button class="chip" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
					{i18n.t('alerts.filter.all')} <span class="count">{totalCount}</span>
				</button>
				<button class="chip" class:active={filter === 'unread'} onclick={() => (filter = 'unread')}>
					{i18n.t('alerts.filter.unread')} <span class="count">{unreadCount}</span>
				</button>
				<button class="chip" class:active={filter === 'read'} onclick={() => (filter = 'read')}>
					{i18n.t('alerts.filter.read')} <span class="count">{readCount}</span>
				</button>
			</div>
		</div>

		{#each filtered as alert (alert.id)}
			<div class="alert" class:unread={!alert.is_read}>
				<div class="alert-ico" class:warn={alert.type === 'partial'}>
					<svg class="icn icn-sm"><use href="#{alertIcon(alert.type)}" /></svg>
				</div>
				<div class="alert-body">
					<div class="alert-head">
						<span class="alert-tag {alertTagClass(alert.type)}">{alertTagLabel(alert.type)}</span>
						<span class="alert-project">{alert.project_name}</span>
						{#if !alert.is_read}
							<span class="alert-unread-badge">{i18n.t('alerts.unread_badge')}</span>
						{/if}
					</div>
					<p class="alert-msg">{alert.message}</p>
					<div class="alert-foot">
						<time>{formatRelative(alert.created_at)}</time>
						<span class="sep">·</span>
						{#if alert.backup_id}
							<a href="/projects/{alert.project_id}/backups/{alert.backup_id}">
								{i18n.t('alerts.go_to_backup')}
								<svg class="icn icn-sm"><use href="#i-arrow" /></svg>
							</a>
						{/if}
						<a href="/projects/{alert.project_id}">
							{i18n.t('alerts.go_to_project')}
							<svg class="icn icn-sm"><use href="#i-arrow" /></svg>
						</a>
					</div>
				</div>
				<div class="alert-actions">
					<button class="icn-btn" title={alert.is_read ? i18n.t('alerts.mark_unread') : i18n.t('alerts.mark_read')} onclick={() => alerts.toggleRead(alert.id)}>
						{#if alert.is_read}
							<svg class="icn"><use href="#i-mail" /></svg>
						{:else}
							<svg class="icn"><use href="#i-check" /></svg>
						{/if}
					</button>
					<button class="icn-btn danger" title={i18n.t('alerts.delete')} onclick={() => alerts.remove(alert.id)}>
						<svg class="icn"><use href="#i-trash" /></svg>
					</button>
				</div>
			</div>
		{/each}

		{#if filtered.length === 0}
			<div class="empty">
				<div class="empty-ico"><svg class="icn"><use href="#i-check" /></svg></div>
				<h2>{i18n.t('alerts.filter_empty.title')}</h2>
				<p>{i18n.t('alerts.filter_empty.help')}</p>
			</div>
		{/if}
	</div>
{/if}

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
	.topbar-actions { display: flex; gap: 0.4rem; }
	.icon-btn {
		width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
		border-radius: 6px; color: var(--color-text-dim);
		border: 1px solid transparent; transition: all 0.12s;
		background: none; cursor: pointer;
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
	.hero-meta .err { color: var(--color-danger); display: inline-flex; align-items: center; gap: 0.35rem; }

	.btn {
		padding: 0.55rem 1rem; border-radius: 8px;
		font-size: 0.84rem; font-weight: 500;
		border: 1px solid var(--color-border); background: var(--color-card);
		color: var(--color-text); display: inline-flex; align-items: center; gap: 0.45rem;
		transition: all 0.12s; cursor: pointer; font-family: inherit;
	}
	.btn:hover { border-color: var(--color-border-2); background: var(--color-card-2); }

	/* List */
	.list { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; overflow: hidden; }
	.list-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--color-border);
		background: rgba(0, 0, 0, 0.15);
	}
	.chips { display: flex; gap: 0.35rem; }
	.chip {
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
	.chip .count { font-family: 'Geist Mono', monospace; font-size: 0.7rem; opacity: 0.7; margin-left: 0.25rem; }
	.chip.active .count { opacity: 1; }

	/* Alert */
	.alert {
		display: grid; grid-template-columns: 36px minmax(0, 1fr) auto;
		gap: 0.95rem; padding: 1.1rem 1.25rem;
		border-top: 1px solid var(--color-border);
		align-items: flex-start;
		transition: background 0.12s;
		position: relative;
	}
	.alert.unread { background: rgba(248, 113, 113, 0.025); }
	.alert.unread:hover { background: rgba(248, 113, 113, 0.045); }
	.alert:not(.unread):hover { background: rgba(255, 255, 255, 0.02); }
	.alert.unread::before {
		content: ''; position: absolute;
		left: 0; top: 0; bottom: 0;
		width: 3px; background: var(--color-danger);
	}

	.alert-ico {
		width: 36px; height: 36px; border-radius: 9px;
		display: flex; align-items: center; justify-content: center;
		flex-shrink: 0; margin-top: 0.1rem;
	}
	.alert.unread .alert-ico { background: rgba(248, 113, 113, 0.1); color: var(--color-danger); }
	.alert:not(.unread) .alert-ico { background: var(--color-border); color: var(--color-text-dim); }
	.alert-ico.warn { background: rgba(251, 146, 60, 0.1); color: var(--color-warn); }
	.alert.unread .alert-ico.warn { background: rgba(251, 146, 60, 0.12); color: var(--color-warn); }

	.alert-body { min-width: 0; }
	.alert-head {
		display: flex; align-items: center; gap: 0.5rem;
		margin-bottom: 0.4rem; flex-wrap: wrap;
	}
	.alert-tag {
		font-family: 'Geist Mono', monospace; font-size: 0.66rem;
		padding: 0.15rem 0.5rem; border-radius: 4px;
		font-weight: 500; letter-spacing: 0.02em;
		background: rgba(248, 113, 113, 0.12); color: var(--color-danger);
	}
	.alert-tag.partial { background: rgba(251, 146, 60, 0.12); color: var(--color-warn); }
	.alert-project { font-size: 0.9rem; font-weight: 600; color: var(--color-text); }
	.alert-unread-badge {
		font-family: 'Geist Mono', monospace; font-size: 0.62rem;
		padding: 0.12rem 0.45rem; border-radius: 3px;
		background: rgba(251, 191, 36, 0.12);
		color: var(--color-accent); font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.08em;
	}
	.alert-msg {
		font-size: 0.88rem; color: var(--color-text);
		line-height: 1.55; margin-bottom: 0.55rem;
	}
	.alert-foot {
		display: flex; align-items: center; gap: 1rem;
		font-size: 0.76rem; color: var(--color-text-dim);
		flex-wrap: wrap;
	}
	.alert-foot time { font-family: 'Geist Mono', monospace; }
	.alert-foot .sep { color: var(--color-text-dimmer); }
	.alert-foot a {
		color: var(--color-accent); display: inline-flex; align-items: center; gap: 0.3rem;
		border-bottom: 1px dashed currentColor; padding-bottom: 1px;
	}
	.alert-foot a:hover { color: var(--color-accent-2); }

	.alert-actions { display: flex; gap: 0.2rem; flex-shrink: 0; opacity: 0; transition: opacity 0.12s; }
	.alert:hover .alert-actions { opacity: 1; }
	.alert.unread .alert-actions { opacity: 0.7; }
	.alert.unread:hover .alert-actions { opacity: 1; }
	.icn-btn {
		width: 30px; height: 30px; border-radius: 6px;
		display: flex; align-items: center; justify-content: center;
		color: var(--color-text-dimmer); transition: all 0.12s;
		background: none; border: none; cursor: pointer;
	}
	.icn-btn:hover { color: var(--color-text); background: rgba(255, 255, 255, 0.06); }
	.icn-btn.danger:hover { color: var(--color-danger); background: rgba(248, 113, 113, 0.08); }

	.empty {
		padding: 4rem 2rem; text-align: center;
	}
	.empty-ico {
		width: 64px; height: 64px; border-radius: 14px;
		background: rgba(74, 222, 128, 0.08);
		color: var(--color-success);
		display: flex; align-items: center; justify-content: center;
		margin: 0 auto 1.25rem;
	}
	.empty-ico .icn { width: 28px; height: 28px; }
	.empty h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.45rem; }
	.empty p { font-size: 0.88rem; color: var(--color-text-dim); }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }
	.icn-sm { width: 12px; height: 12px; }

	@media (max-width: 760px) {
		.hero { flex-direction: column; align-items: flex-start; }
		.hero-actions { width: 100%; }
		.hero-actions .btn { width: 100%; justify-content: center; }
		.crumbs { font-size: 0.78rem; }
		.crumbs b { font-size: 0.76rem; }
		.list-head { padding: 0.85rem 1rem; }
		.chips { flex-wrap: wrap; }
		.alert { padding: 0.95rem 1rem; gap: 0.7rem; grid-template-columns: 32px minmax(0, 1fr); }
		.alert-actions { grid-column: 1 / -1; justify-content: flex-end; opacity: 1; margin-top: -0.5rem; }
		.alert-head { gap: 0.35rem; }
		.alert-foot { gap: 0.5rem 0.85rem; }
	}
</style>
