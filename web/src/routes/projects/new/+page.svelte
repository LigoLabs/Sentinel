<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import type { TranslationKey } from '$lib/i18n/dict';
	import { humanCron } from '$lib/utils/cron';

	let name = $state('');
	let description = $state('');
	let cronDisposable = $state('0 3 * * *');
	let retentionCount = $state(15);
	let lifetimeEnabled = $state(true);
	let cronLifetime = $state('0 3 1 * *');
	let saving = $state(false);

	const disposablePresets: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.daily_3', value: '0 3 * * *' },
		{ key: 'project.new.cron.preset.daily_midnight', value: '0 0 * * *' },
		{ key: 'project.new.cron.preset.every_6h', value: '0 */6 * * *' },
		{ key: 'project.new.cron.preset.every_12h', value: '0 0,12 * * *' },
		{ key: 'project.new.cron.preset.weekly_sunday', value: '0 3 * * 0' },
		{ key: 'project.new.cron.preset.monthly_1st', value: '0 3 1 * *' },
	];

	const lifetimePresets: { key: TranslationKey; value: string }[] = [
		{ key: 'project.new.cron.preset.monthly_1st', value: '0 3 1 * *' },
		{ key: 'project.new.cron.preset.yearly', value: '0 3 1 1 *' },
	];

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!name.trim()) return;
		saving = true;
		try {
			const project = await api.post<{ id: number }>('/projects', {
				name: name.trim(),
				description,
				schedule: {
					cron_expression: cronDisposable,
					retention_count: retentionCount,
					retention_monthly: lifetimeEnabled,
					cron_lifetime: lifetimeEnabled ? cronLifetime : null,
				},
			});
			toast.success(i18n.t('project.new.created', { name }));
			projectsStore.invalidate();
			goto(`/projects/${project.id}`);
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			saving = false;
		}
	}
</script>

<div class="wrap">
	<div class="topbar">
		<div class="crumbs">
			<a href="/projects" class="back-link" aria-label={i18n.t('common.back')}><svg class="icn"><use href="#i-back" /></svg></a>
			<a href="/projects">{i18n.t('projects.title')}</a>
			<span class="sep">/</span>
			<b>{i18n.t('project.new.title')}</b>
		</div>
	</div>

	<div class="hero">
		<h1>{i18n.t('project.new.title')}</h1>
		<p>{i18n.t('project.new.hero_help')}</p>
	</div>

	<form onsubmit={handleSubmit}>
		<!-- Informations -->
		<div class="card">
			<div class="card-head"><div class="card-title">{i18n.t('project.new.section.info')}</div></div>
			<div class="card-body">
				<div class="field">
					<label for="name">{i18n.t('project.new.name')}</label>
					<input
						id="name"
						type="text"
						bind:value={name}
						placeholder={i18n.t('project.new.name_placeholder')}
						required
					/>
					<p class="field-help">{i18n.t('project.new.name_help')}</p>
				</div>
				<div class="field">
					<label for="desc">{i18n.t('project.new.description')} <small>({i18n.t('project.new.optional')})</small></label>
					<textarea
						id="desc"
						bind:value={description}
						rows="3"
						placeholder={i18n.t('project.new.description_placeholder')}
					></textarea>
				</div>
			</div>
		</div>

		<!-- Planification -->
		<div class="card">
			<div class="card-head"><div class="card-title">{i18n.t('project.new.section.schedule')} <small>cron + rétention</small></div></div>
			<div class="card-body">

				<!-- Sauvegardes avec rétention -->
				<div class="sub-card">
					<h4>
						<span class="ico"><svg class="icn"><use href="#i-clock" /></svg></span>
						{i18n.t('project.new.disposable.title')}
					</h4>
					<p class="sub-help">{i18n.t('project.new.disposable.help')}</p>

					<div class="field">
						<label for="cron-disp">{i18n.t('project.new.disposable.cron')}</label>
						<input id="cron-disp" type="text" class="mono" bind:value={cronDisposable} />
						<div class="presets">
							{#each disposablePresets as preset}
								<button
									type="button"
									class="chip"
									class:active={cronDisposable === preset.value}
									onclick={() => (cronDisposable = preset.value)}
								>
									{i18n.t(preset.key)}
								</button>
							{/each}
						</div>
						<p class="cron-preview"><svg class="icn icn-sm"><use href="#i-clock" /></svg> {humanCron(cronDisposable)}</p>
					</div>

					<div class="field">
						<label for="ret">{i18n.t('project.new.disposable.retention')}</label>
						<div class="field-row">
							<input id="ret" type="number" bind:value={retentionCount} min="1" max="999" />
							<span>{i18n.t('project.new.disposable.retention_unit')}</span>
						</div>
					</div>
				</div>

				<!-- Sauvegardes à vie -->
				<div class="sub-card">
					<h4>
						<span class="ico lifetime"><svg class="icn"><use href="#i-cal" /></svg></span>
						{i18n.t('project.new.lifetime.title')}
					</h4>
					<p class="sub-help">{i18n.t('project.new.lifetime.help')}</p>

					<label class="toggle-line">
						<input type="checkbox" bind:checked={lifetimeEnabled} />
						<span>{i18n.t('project.new.lifetime.enable')}</span>
					</label>

					{#if lifetimeEnabled}
						<div class="field">
							<label for="cron-life">{i18n.t('project.new.lifetime.cron')}</label>
							<input id="cron-life" type="text" class="mono" bind:value={cronLifetime} />
							<div class="presets">
								{#each lifetimePresets as preset}
									<button
										type="button"
										class="chip"
										class:active={cronLifetime === preset.value}
										onclick={() => (cronLifetime = preset.value)}
									>
										{i18n.t(preset.key)}
									</button>
								{/each}
							</div>
							<p class="cron-preview"><svg class="icn icn-sm"><use href="#i-clock" /></svg> {humanCron(cronLifetime)}</p>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="form-foot">
			<p>{i18n.t('project.new.help_after')}</p>
			<div class="form-actions">
				<a class="btn ghost" href="/projects">{i18n.t('common.cancel')}</a>
				<button type="submit" class="btn primary" disabled={saving || !name.trim()}>
					<svg class="icn"><use href="#i-plus" /></svg>
					{saving ? i18n.t('project.new.submitting') : i18n.t('project.new.submit')}
				</button>
			</div>
		</div>
	</form>
</div>

<style>
	.wrap { width: 100%; }

	.topbar {
		display: flex; justify-content: space-between; align-items: center;
		padding-bottom: 1.25rem; margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}
	.crumbs { display: flex; align-items: center; gap: 0.55rem; font-size: 0.82rem; color: var(--color-text-dim); }
	.crumbs a:hover { color: var(--color-text); }
	.crumbs b { color: var(--color-text); font-weight: 500; }
	.crumbs .sep { opacity: 0.4; }
	.back-link { display: inline-flex; }

	.hero { padding: 1.75rem 0 2rem; }
	.hero h1 { font-size: 1.85rem; font-weight: 600; letter-spacing: -0.025em; margin-bottom: 0.5rem; }
	.hero p { font-size: 0.9rem; color: var(--color-text-dim); }

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
	.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
	.btn.ghost { background: transparent; border-color: transparent; color: var(--color-text-dim); }
	.btn.ghost:hover { background: var(--color-card); color: var(--color-text); border-color: var(--color-border); }

	.card { background: var(--color-card); border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
	.card-head { padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); }
	.card-title { font-size: 0.95rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.5rem; }
	.card-title small { font-weight: 400; color: var(--color-text-dim); font-size: 0.78rem; margin-left: 0.4rem; }
	.card-body { padding: 1.25rem; }

	.field { margin-bottom: 1.1rem; }
	.field:last-child { margin-bottom: 0; }
	.field label {
		display: block;
		font-size: 0.78rem; font-weight: 500;
		color: var(--color-text); margin-bottom: 0.45rem;
	}
	.field label small { font-weight: 400; color: var(--color-text-dim); font-size: 0.74rem; }
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
	.field input::placeholder, .field textarea::placeholder { color: var(--color-text-dimmer); }
	.field-help { margin-top: 0.4rem; font-size: 0.76rem; color: var(--color-text-dim); }

	.field-row { display: flex; align-items: center; gap: 0.7rem; }
	.field-row input { width: 90px; }
	.field-row span { font-size: 0.85rem; color: var(--color-text-dim); }

	.sub-card {
		padding: 1.1rem 1.2rem;
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		margin-bottom: 1rem;
	}
	.sub-card:last-child { margin-bottom: 0; }
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
	.cron-preview svg { color: var(--color-accent); width: 12px; height: 12px; }

	.toggle-line {
		display: flex; align-items: center; gap: 0.6rem;
		cursor: pointer; padding: 0.6rem 0.85rem;
		background: var(--color-bg); border: 1px solid var(--color-border);
		border-radius: 8px;
		font-size: 0.85rem; color: var(--color-text);
		margin-bottom: 1rem;
	}
	.toggle-line:hover { border-color: var(--color-border-2); }
	.toggle-line input { accent-color: var(--color-accent); width: 16px; height: 16px; cursor: pointer; }

	.form-foot {
		display: flex; justify-content: space-between; align-items: center;
		gap: 1.5rem; padding-top: 0.5rem;
		flex-wrap: wrap;
	}
	.form-foot p { font-size: 0.8rem; color: var(--color-text-dim); max-width: 520px; line-height: 1.5; }
	.form-actions { display: flex; gap: 0.5rem; }

	.icn { width: 14px; height: 14px; flex-shrink: 0; }

	@media (max-width: 760px) {
		.crumbs { font-size: 0.78rem; flex-wrap: wrap; }
		.card-head { padding: 0.85rem 1rem; }
		.card-body { padding: 1rem; }
		.sub-card { padding: 0.95rem 1rem; }
		.presets { gap: 0.3rem; }
		.chip { font-size: 0.72rem; padding: 0.3rem 0.6rem; }
		.form-foot { flex-direction: column; align-items: stretch; gap: 1rem; }
		.form-foot p { max-width: none; }
		.form-actions { width: 100%; }
		.form-actions .btn { flex: 1; justify-content: center; }
	}
</style>
