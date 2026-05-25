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

<div class="login-page">
	<div class="lang">
		<svg class="icn"><use href="#i-globe" /></svg>
		<select value={i18n.lang} onchange={onLangChange} aria-label={i18n.t('nav.language')}>
			{#each i18n.languages as l}
				<option value={l.code}>{l.label}</option>
			{/each}
		</select>
	</div>

	<div class="box">
		<div class="brand">
			<div class="brand-mark">S</div>
			<div>
				<h1>{i18n.t('login.title')}</h1>
				<p>{i18n.t('login.subtitle')}</p>
			</div>
		</div>

		<div class="default-warn">
			<div class="label">
				<svg class="icn"><use href="#i-warning" /></svg>
				{i18n.t('login.default_password.label')}
			</div>
			{@html i18n.t('login.default_password.warning', {
				var: '<code class="accent">ADMIN_PASSWORD</code>',
				envFile: '<code class="accent">.env</code>',
			})}
		</div>

		<form onsubmit={handleSubmit}>
			{#if errorMessage}
				<div class="error">
					<svg class="icn"><use href="#i-x" /></svg>
					<span>{errorMessage}</span>
				</div>
			{/if}

			<div class="field">
				<label for="password">{i18n.t('login.password')}</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					autocomplete="current-password"
					required
				/>
			</div>

			<button type="submit" class="submit" disabled={loading}>
				{#if loading}
					<span class="spinner"></span>
				{:else}
					{i18n.t('login.submit')}
				{/if}
			</button>
		</form>

		<p class="foot">Sentinel v0.2 · self-hosted backup orchestrator</p>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex; align-items: center; justify-content: center;
		padding: 2rem; position: relative; overflow: hidden;
	}
	.login-page::before {
		content: ''; position: absolute; inset: 0; pointer-events: none;
		background-image:
			linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
			linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
		background-size: 48px 48px;
		mask-image: radial-gradient(ellipse at center, #000 30%, transparent 75%);
	}
	.login-page::after {
		content: ''; position: absolute; inset: 0; pointer-events: none;
		background:
			radial-gradient(ellipse at 50% 30%, rgba(251, 191, 36, 0.08), transparent 50%),
			radial-gradient(ellipse at 80% 80%, rgba(167, 139, 250, 0.05), transparent 50%);
	}

	.lang {
		position: fixed; top: 1.25rem; right: 1.25rem;
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.78rem; color: var(--color-text-dim); z-index: 10;
	}
	.lang select {
		font: inherit; color: var(--color-text);
		background: var(--color-card); border: 1px solid var(--color-border);
		border-radius: 6px; padding: 0.35rem 0.6rem; cursor: pointer;
	}
	.lang select:focus { outline: none; border-color: var(--color-accent); }

	.box { width: 100%; max-width: 380px; position: relative; z-index: 1; }
	.brand {
		display: flex; flex-direction: column; align-items: center;
		gap: 1.25rem; margin-bottom: 2.5rem;
	}
	.brand-mark {
		width: 56px; height: 56px; border-radius: 14px;
		background: linear-gradient(135deg, var(--color-accent), #f59e0b);
		display: flex; align-items: center; justify-content: center;
		color: #1a1208; font-family: 'Geist Mono', monospace;
		font-weight: 700; font-size: 1.5rem;
		box-shadow:
			0 0 40px rgba(251, 191, 36, 0.3),
			0 0 0 1px rgba(251, 191, 36, 0.2),
			0 8px 32px rgba(0, 0, 0, 0.4);
	}
	.brand h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; text-align: center; }
	.brand p {
		font-size: 0.88rem; color: var(--color-text-dim);
		text-align: center; max-width: 300px; line-height: 1.5;
		margin-top: 0.4rem;
	}

	.default-warn {
		padding: 0.85rem 1rem;
		background: rgba(251, 146, 60, 0.05);
		border: 1px solid rgba(251, 146, 60, 0.2);
		border-radius: 10px;
		margin-bottom: 1rem;
		font-size: 0.82rem; color: var(--color-text-dim);
		line-height: 1.5;
	}
	.default-warn .label {
		color: var(--color-warn); font-weight: 500;
		display: inline-flex; align-items: center; gap: 0.4rem;
		margin-bottom: 0.3rem;
	}
	.default-warn :global(code) {
		font-family: 'Geist Mono', monospace; font-size: 0.78rem;
		padding: 0.1rem 0.4rem; border-radius: 4px;
		background: rgba(0, 0, 0, 0.3);
	}
	.default-warn :global(code.accent) { color: var(--color-accent); }
	.default-warn :global(code.warn) { color: var(--color-warn); }

	form {
		padding: 1.5rem;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: 14px;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
	}
	.field { margin-bottom: 1rem; }
	.field label {
		display: block; font-size: 0.8rem; font-weight: 500;
		color: var(--color-text); margin-bottom: 0.4rem;
	}
	.field input {
		width: 100%; padding: 0.7rem 0.9rem;
		background: var(--color-bg); color: var(--color-text);
		border: 1px solid var(--color-border); border-radius: 8px;
		font: inherit; transition: border-color 0.12s;
	}
	.field input:focus {
		outline: none; border-color: var(--color-accent);
		box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.12);
	}
	.field input::placeholder {
		color: var(--color-text-dimmer);
		font-family: 'Geist Mono', monospace; letter-spacing: 0.2em;
	}

	.error {
		padding: 0.7rem 0.9rem; margin-bottom: 1rem;
		background: rgba(248, 113, 113, 0.08);
		border: 1px solid rgba(248, 113, 113, 0.25);
		border-radius: 8px;
		font-size: 0.82rem; color: var(--color-danger);
		display: flex; align-items: center; gap: 0.5rem;
	}

	.submit {
		width: 100%; padding: 0.7rem 1rem;
		background: var(--color-accent); color: #1a1208;
		border-radius: 8px; font-weight: 600; font-size: 0.92rem;
		font-family: inherit; border: none; cursor: pointer;
		transition: all 0.12s;
		display: flex; align-items: center; justify-content: center; gap: 0.5rem;
		box-shadow: 0 0 24px rgba(251, 191, 36, 0.2);
	}
	.submit:hover:not(:disabled) {
		background: var(--color-accent-2);
		box-shadow: 0 4px 32px rgba(251, 191, 36, 0.3);
	}
	.submit:disabled { opacity: 0.7; cursor: not-allowed; }
	.spinner {
		display: inline-block; width: 16px; height: 16px;
		border: 2px solid rgba(26, 18, 8, 0.3);
		border-top-color: #1a1208; border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.foot {
		margin-top: 1.5rem; text-align: center;
		font-size: 0.72rem; color: var(--color-text-dimmer);
		font-family: 'Geist Mono', monospace; letter-spacing: 0.05em;
	}

	.icn { width: 14px; height: 14px; }
</style>
