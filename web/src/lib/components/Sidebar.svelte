<script lang="ts">
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import { i18n, type Lang } from '$lib/i18n/index.svelte';
	import type { TranslationKey } from '$lib/i18n/dict';

	type NavItem = { href: string; key: TranslationKey; icon: string; badge?: 'alerts' };

	const nav: NavItem[] = [
		{ href: '/', key: 'nav.dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
		{ href: '/projects', key: 'nav.projects', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
		{ href: '/alerts', key: 'nav.alerts', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', badge: 'alerts' },
		{ href: '/settings', key: 'nav.settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
	];

	function isActive(href: string): boolean {
		if (href === '/') return $page.url.pathname === '/';
		return $page.url.pathname.startsWith(href);
	}

	function onLangChange(e: Event) {
		i18n.setLang((e.currentTarget as HTMLSelectElement).value as Lang);
	}
</script>

<aside class="flex h-full w-60 flex-col border-r border-surface-700 bg-surface-900">
	<div class="flex items-center gap-2 px-5 py-5">
		<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-white text-sm">S</div>
		<span class="text-lg font-bold text-white">Sentinel</span>
	</div>

	<nav class="flex-1 space-y-0.5 px-3">
		{#each nav as item}
			<a
				href={item.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition {isActive(item.href) ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-surface-800 hover:text-white'}"
			>
				<svg class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d={item.icon} />
				</svg>
				<span class="flex-1">{i18n.t(item.key)}</span>
				{#if item.badge === 'alerts' && alerts.unreadCount > 0}
					<span class="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
						{alerts.unreadCount > 99 ? '99+' : alerts.unreadCount}
					</span>
				{/if}
			</a>
		{/each}
	</nav>

	<div class="border-t border-surface-700 px-3 py-3 space-y-2">
		<label class="flex items-center gap-2 px-3 text-xs uppercase tracking-wide text-slate-500">
			<span>{i18n.t('nav.language')}</span>
		</label>
		<select
			value={i18n.lang}
			onchange={onLangChange}
			class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm text-slate-300 focus:border-accent focus:outline-none"
		>
			{#each i18n.languages as l}
				<option value={l.code}>{l.label}</option>
			{/each}
		</select>

		<button
			onclick={() => auth.logout()}
			class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-surface-800 hover:text-white"
		>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
			</svg>
			{i18n.t('nav.logout')}
		</button>
	</div>
</aside>
