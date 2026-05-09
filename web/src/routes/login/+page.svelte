<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { i18n, type Lang } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';

	let password = $state('');
	let loading = $state(false);
	let errorMessage = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!password) return;
		loading = true;
		errorMessage = '';

		try {
			await auth.login(password);
		} catch (err) {
			errorMessage = translateError(err);
		} finally {
			loading = false;
		}
	}

	function onLangChange(e: Event) {
		i18n.setLang((e.currentTarget as HTMLSelectElement).value as Lang);
	}
</script>

<div class="relative flex min-h-screen items-center justify-center bg-surface-950">
	<div class="absolute right-4 top-4 flex items-center gap-2">
		<svg class="h-4 w-4 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
		</svg>
		<select
			value={i18n.lang}
			onchange={onLangChange}
			aria-label={i18n.t('nav.language')}
			class="rounded-md border border-surface-700 bg-surface-900 px-2 py-1 text-xs text-slate-300 focus:border-accent focus:outline-none"
		>
			{#each i18n.languages as l}
				<option value={l.code}>{l.label}</option>
			{/each}
		</select>
	</div>

	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-xl font-bold text-white">
				S
			</div>
			<h1 class="text-2xl font-bold text-white">{i18n.t('login.title')}</h1>
			<p class="mt-1 text-sm text-surface-600">{i18n.t('login.subtitle')}</p>
		</div>

		<div class="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-xs text-slate-300">
			<p>
				<span class="text-warning">{i18n.t('login.default_password.label')}</span>
				<code class="ml-1 rounded bg-surface-800 px-1.5 py-0.5 font-mono text-warning">sentinel</code>
			</p>
			<p class="mt-1 text-surface-500">
				{@html i18n.t('login.default_password.warning', {
					var: '<code class="rounded bg-surface-800 px-1 py-0.5 font-mono text-accent">ADMIN_PASSWORD</code>',
					envFile: '<code class="rounded bg-surface-800 px-1 py-0.5 font-mono text-accent">.env</code>',
				})}
			</p>
		</div>

		<form onsubmit={handleSubmit} class="space-y-4 rounded-xl border border-surface-700 bg-surface-900 p-6">
			{#if errorMessage}
				<div class="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
					{errorMessage}
				</div>
			{/if}

			<div>
				<label for="password" class="mb-1 block text-sm font-medium text-slate-300">{i18n.t('login.password')}</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					class="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-white placeholder-surface-600 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					placeholder="••••••••"
					required
				/>
			</div>

			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
			>
				{#if loading}
					<span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
				{:else}
					{i18n.t('login.submit')}
				{/if}
			</button>
		</form>
	</div>
</div>
