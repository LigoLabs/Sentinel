<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { alerts } from '$lib/stores/alerts.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toast from '$lib/components/Toast.svelte';

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
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{#if !auth.checked}
	<div class="flex h-screen items-center justify-center bg-surface-950">
		<div class="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
	</div>
{:else if isPublicRoute}
	{@render children()}
{:else if auth.authenticated}
	<div class="flex h-screen overflow-hidden">
		<Sidebar />
		<main class="flex-1 overflow-y-auto p-6">
			{@render children()}
		</main>
	</div>
{/if}

<Toast />
