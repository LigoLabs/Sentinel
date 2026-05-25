<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { i18n, type Lang } from '$lib/i18n/index.svelte';

	const PROJECT_COLORS = ['#fbbf24', '#22d3ee', '#a78bfa', '#4ade80', '#fb923c', '#f87171'];

	function projectColor(id: number): string {
		return PROJECT_COLORS[id % PROJECT_COLORS.length];
	}

	function isSection(prefix: string): boolean {
		return $page.url.pathname.startsWith(prefix);
	}

	const onDashboard = $derived($page.url.pathname === '/');
	const onProjects = $derived(isSection('/projects'));
	const onAlerts = $derived(isSection('/alerts'));
	const onSettings = $derived(isSection('/settings'));

	const currentProjectId = $derived.by(() => {
		const m = $page.url.pathname.match(/^\/projects\/(\d+)/);
		return m ? Number(m[1]) : null;
	});

	// Drawer mobile
	let mobileOpen = $state(false);
	// Ferme le drawer à chaque changement de route
	$effect(() => {
		const _ = $page.url.pathname; // souscrit à la dépendance
		mobileOpen = false;
	});
	function closeDrawer() { mobileOpen = false; }

	// Sentinel est mono-utilisateur (1 mot de passe admin). On affiche un libellé
	// neutre plutôt qu'un email inventé.
	const userInitials = 'SE';

	function onLangChange(e: Event) {
		i18n.setLang((e.currentTarget as HTMLSelectElement).value as Lang);
	}

	onMount(() => {
		projectsStore.load();
	});
</script>

<!-- Bouton hamburger : visible uniquement en mobile, fixed pour rester accessible -->
<button class="ham" onclick={() => (mobileOpen = !mobileOpen)} aria-label={i18n.t('nav.menu')} title={i18n.t('nav.menu')}>
	{#if mobileOpen}
		<svg class="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
	{:else}
		<svg class="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
	{/if}
</button>

{#if mobileOpen}
	<button class="overlay" onclick={closeDrawer} aria-label={i18n.t('common.close')}></button>
{/if}

<aside class="side sticky top-0 flex h-screen flex-col border-r border-border bg-bg-side px-3 py-5" class:open={mobileOpen}>
	<!-- Brand -->
	<a href="/" class="mb-6 flex items-center gap-2.5 px-2.5">
		<div class="brand-mark">S</div>
		<div class="flex flex-col leading-tight">
			<span class="text-[0.95rem] font-semibold tracking-tight text-text">Sentinel</span>
			<span class="font-mono text-[0.66rem] tracking-wide text-text-dimmer">v0.2 · self-hosted</span>
		</div>
	</a>

	<!-- Espace section -->
	<div class="sec-label">{i18n.t('nav.section.workspace')}</div>

	<a href="/" class="link" class:active={onDashboard}>
		<svg class="icn"><use href="#i-home" /></svg>
		<span>{i18n.t('nav.dashboard')}</span>
	</a>

	<a href="/projects" class="link expand" class:active={onProjects && !currentProjectId}>
		<span class="flex items-center gap-2.5">
			<svg class="icn"><use href="#i-grid" /></svg>
			<span>{i18n.t('nav.projects')}</span>
		</span>
		{#if projectsStore.loaded && projectsStore.items.length > 0}
			<span class="badge">{projectsStore.items.length}</span>
		{/if}
	</a>

	{#if projectsStore.items.length > 0}
		<div class="sublist">
			{#each projectsStore.items as project (project.id)}
				<a
					href="/projects/{project.id}"
					class="sublink"
					class:active={currentProjectId === project.id}
				>
					<span class="dot" style="background:{currentProjectId === project.id ? 'currentColor' : projectColor(project.id)}"></span>
					<span class="truncate">{project.name}</span>
				</a>
			{/each}
		</div>
	{/if}

	<a href="/alerts" class="link" class:active={onAlerts}>
		<svg class="icn"><use href="#i-bell" /></svg>
		<span>{i18n.t('nav.alerts')}</span>
		{#if alerts.unreadCount > 0}
			<span class="badge alert">{alerts.unreadCount > 99 ? '99+' : alerts.unreadCount}</span>
		{/if}
	</a>

	<!-- Système section -->
	<div class="sec-label">{i18n.t('nav.section.system')}</div>

	<a href="/settings" class="link" class:active={onSettings}>
		<svg class="icn"><use href="#i-cog" /></svg>
		<span>{i18n.t('nav.settings')}</span>
	</a>

	<!-- Lang switcher (subtle, above footer) -->
	<div class="mt-auto pt-2">
		<div class="sec-label">{i18n.t('nav.language')}</div>
		<select
			value={i18n.lang}
			onchange={onLangChange}
			aria-label={i18n.t('nav.language')}
			class="mx-2 mb-3 w-[calc(100%-1rem)] rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-text focus:border-accent focus:outline-none"
		>
			{#each i18n.languages as l}
				<option value={l.code}>{l.label}</option>
			{/each}
		</select>
	</div>

	<!-- Footer -->
	<div class="flex items-center gap-2.5 border-t border-border px-2 pt-3">
		<div class="avatar">{userInitials}</div>
		<div class="flex-1 overflow-hidden text-sm leading-tight">
			<div class="truncate text-text">{i18n.t('nav.user.admin')}</div>
			<div class="truncate font-mono text-[0.7rem] text-text-dimmer">{i18n.t('nav.user.session')}</div>
		</div>
		<button
			class="rounded-md p-1.5 text-text-dimmer transition hover:bg-card hover:text-text"
			title={i18n.t('nav.logout')}
			onclick={() => auth.logout()}
		>
			<svg class="icn"><use href="#i-logout" /></svg>
		</button>
	</div>
</aside>

<style>
	.brand-mark {
		display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; border-radius: 8px;
		background: linear-gradient(135deg, var(--color-accent), #f59e0b);
		color: #1a1208; font-family: 'Geist Mono', monospace;
		font-weight: 700; font-size: 0.95rem;
		box-shadow: 0 0 24px rgba(251, 191, 36, 0.18);
	}
	.sec-label {
		font-size: 0.64rem; font-weight: 600;
		letter-spacing: 0.14em; text-transform: uppercase;
		color: var(--color-text-dimmer);
		padding: 0.85rem 0.7rem 0.45rem;
	}
	.link {
		display: flex; align-items: center; gap: 0.7rem;
		padding: 0.5rem 0.7rem; border-radius: 7px;
		font-size: 0.86rem; color: #a1aabe;
		transition: all 0.12s; position: relative;
	}
	.link:hover { background: rgba(255, 255, 255, 0.04); color: var(--color-text); }
	.link.active {
		background: rgba(251, 191, 36, 0.08);
		color: var(--color-accent);
	}
	.link.active::before {
		content: ''; position: absolute;
		left: -0.75rem; top: 25%; bottom: 25%;
		width: 2px; background: var(--color-accent);
		border-radius: 2px;
		box-shadow: 0 0 8px rgba(251, 191, 36, 0.5);
	}
	.link.expand { justify-content: space-between; }
	.badge {
		margin-left: auto; padding: 0.08rem 0.45rem;
		font-size: 0.65rem; background: var(--color-border);
		border-radius: 999px; color: var(--color-text-dim);
		font-family: 'Geist Mono', monospace; font-weight: 500;
	}
	.link.active .badge { background: rgba(251, 191, 36, 0.15); color: var(--color-accent); }
	.badge.alert {
		background: rgba(248, 113, 113, 0.12); color: var(--color-danger);
	}

	.sublist {
		padding: 0.2rem 0 0 1.25rem;
		border-left: 1px solid var(--color-border);
		margin-left: 1.4rem;
	}
	.sublink {
		display: flex; align-items: center; gap: 0.55rem;
		padding: 0.42rem 0.7rem; border-radius: 6px;
		font-size: 0.82rem; color: var(--color-text-dim);
		transition: all 0.12s; position: relative;
	}
	.sublink:hover { background: rgba(255, 255, 255, 0.03); color: #c8cee0; }
	.sublink.active {
		background: rgba(251, 191, 36, 0.08);
		color: var(--color-accent);
	}
	.sublink.active::before {
		content: ''; position: absolute;
		left: -1.25rem; top: 25%; bottom: 25%;
		width: 2px; background: var(--color-accent);
		border-radius: 2px;
		box-shadow: 0 0 8px rgba(251, 191, 36, 0.5);
	}
	.sublink .dot {
		width: 6px; height: 6px; border-radius: 50%;
		opacity: 0.85; flex-shrink: 0;
	}

	.avatar {
		width: 30px; height: 30px; border-radius: 50%;
		background: linear-gradient(135deg, #818cf8, #a855f7);
		display: flex; align-items: center; justify-content: center;
		font-size: 0.78rem; font-weight: 700; color: #0a0e1a;
		flex-shrink: 0;
	}

	.icn {
		width: 14px; height: 14px;
		flex-shrink: 0;
	}

	/* --- Mobile drawer --- */
	.ham {
		display: none;
		position: fixed; top: 0.75rem; left: 0.75rem; z-index: 60;
		width: 38px; height: 38px; border-radius: 8px;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		color: var(--color-text);
		align-items: center; justify-content: center;
		cursor: pointer; transition: background 0.12s;
	}
	.ham:hover { background: var(--color-card-2); }
	.ham .icn { width: 18px; height: 18px; }
	.overlay {
		position: fixed; inset: 0; z-index: 49;
		background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(2px);
		border: none; padding: 0;
		cursor: pointer;
	}

	@media (max-width: 900px) {
		.ham { display: inline-flex; }
		.side {
			position: fixed !important;
			top: 0; left: 0; bottom: 0;
			width: 280px; height: 100vh;
			transform: translateX(-100%);
			transition: transform 0.2s ease-out;
			z-index: 50;
			box-shadow: 8px 0 32px rgba(0, 0, 0, 0.4);
		}
		.side.open { transform: translateX(0); }
	}
</style>
