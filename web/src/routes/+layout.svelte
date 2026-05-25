<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import IconSprite from '$lib/components/IconSprite.svelte';

	let { children } = $props();

	const publicRoutes = ['/login'];
	let isPublicRoute = $derived(publicRoutes.includes($page.url.pathname));

	$effect(() => {
		if (!auth.checked) return;
		if (!auth.authenticated && !isPublicRoute) {
			goto('/login');
		}
		if (auth.authenticated && isPublicRoute) {
			goto('/');
		}
	});

	$effect(() => {
		if (auth.authenticated) alerts.startPolling();
		else alerts.stopPolling();
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@300..600&display=swap" rel="stylesheet" />
</svelte:head>

<IconSprite />

{#if !auth.checked}
	<div class="flex h-screen items-center justify-center bg-bg">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if isPublicRoute}
	{@render children()}
{:else if auth.authenticated}
	<div class="app-grid">
		<Sidebar />
		<main class="min-w-0">
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.app-grid {
		display: grid;
		grid-template-columns: 248px 1fr;
		min-height: 100vh;
	}
	.app-grid main {
		padding: 1.5rem 2rem 4rem;
	}
	@media (max-width: 900px) {
		.app-grid { grid-template-columns: 1fr; }
		/* On laisse 3.5rem en haut pour que le bouton hamburger (fixed) ne masque pas le breadcrumb */
		.app-grid main { padding: 3.75rem 1rem 3rem; }
	}
</style>

<Toast />
