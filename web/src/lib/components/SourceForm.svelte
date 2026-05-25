<script lang="ts">
	import { api } from '$lib/api';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/i18n/index.svelte';
	import { translateError } from '$lib/i18n/errors';
	import type { TranslationKey } from '$lib/i18n/dict';

	interface EditSourceData {
		id: number;
		type: string;
		label: string;
		config: Record<string, unknown>;
	}

	const props = $props<{
		projectId: number;
		onCreated: () => void;
		editSource?: EditSourceData;
	}>();

	const projectId = $derived(props.projectId);
	const onCreated = $derived(props.onCreated);
	const isEdit = $derived(!!props.editSource);
	const initialSourceId = $derived(props.editSource?.id);

	function initFromEdit(src?: EditSourceData) {
		if (!src) return {};
		const c = src.config;
		const base: Record<string, any> = { type: src.type, label: src.label };
		if (src.type === 'turso') {
			base.tursoUrl = (c.url as string) || '';
			base.tursoToken = (c.authToken as string) || '';
		} else if (src.type === 'vercel-blob') {
			base.blobToken = (c.token as string) || '';
		} else if (src.type === 'mysql-ssh' || src.type === 'postgres-ssh' || src.type === 'ssh-sftp') {
			base.sshHost = (c.sshHost as string) || '';
			base.sshPort = String(c.sshPort || 22);
			base.sshUser = (c.sshUser as string) || '';
			if (c.sshPrivateKey) {
				base.sshAuthMethod = 'key';
				base.sshPrivateKey = c.sshPrivateKey as string;
			} else {
				base.sshAuthMethod = 'password';
				base.sshPassword = (c.sshPassword as string) || '';
			}
			if (src.type === 'ssh-sftp') {
				base.remotePath = (c.remotePath as string) || '';
				base.useSudo = !!c.useSudo;
			} else if (src.type === 'mysql-ssh') {
				base.mysqlHost = (c.mysqlHost as string) || '127.0.0.1';
				base.mysqlPort = String(c.mysqlPort || 3306);
				base.mysqlUser = (c.mysqlUser as string) || 'root';
				base.mysqlPassword = (c.mysqlPassword as string) || '';
				base.mysqlDatabase = (c.mysqlDatabase as string) || '';
			} else {
				base.pgHost = (c.pgHost as string) || '127.0.0.1';
				base.pgPort = String(c.pgPort || 5432);
				base.pgUser = (c.pgUser as string) || 'postgres';
				base.pgPassword = (c.pgPassword as string) || '';
				base.pgDatabase = (c.pgDatabase as string) || '';
			}
		} else if (src.type === 'ftp' || src.type === 'wordpress') {
			base.ftpHost = (c.ftpHost as string) || '';
			base.ftpPort = String(c.ftpPort || 21);
			base.ftpUser = (c.ftpUser as string) || '';
			base.ftpPassword = (c.ftpPassword as string) || '';
			base.ftpSecure = !!c.ftpSecure;
			if (src.type === 'ftp') {
				base.remotePath = (c.remotePath as string) || '';
			} else {
				base.remoteWebRoot = (c.remoteWebRoot as string) || '';
				base.siteUrl = (c.siteUrl as string) || '';
			}
		}
		return base;
	}

	const init = initFromEdit(props.editSource);

	let type = $state(init.type || 'turso');
	let label = $state(init.label || '');
	let saving = $state(false);
	let testing = $state(false);

	let tursoUrl = $state(init.tursoUrl || '');
	let tursoToken = $state(init.tursoToken || '');
	let blobToken = $state(init.blobToken || '');
	let sshHost = $state(init.sshHost || '');
	let sshPort = $state(init.sshPort || '22');
	let sshUser = $state(init.sshUser || '');
	let sshPassword = $state(init.sshPassword || '');
	let sshAuthMethod = $state<'password' | 'key'>(init.sshAuthMethod || 'password');
	let sshPrivateKey = $state(init.sshPrivateKey || '');
	let remotePath = $state(init.remotePath || '');
	let useSudo = $state(init.useSudo || false);
	let mysqlHost = $state(init.mysqlHost || '127.0.0.1');
	let mysqlPort = $state(init.mysqlPort || '3306');
	let mysqlUser = $state(init.mysqlUser || 'root');
	let mysqlPassword = $state(init.mysqlPassword || '');
	let mysqlDatabase = $state(init.mysqlDatabase || '');
	let pgHost = $state(init.pgHost || '127.0.0.1');
	let pgPort = $state(init.pgPort || '5432');
	let pgUser = $state(init.pgUser || 'postgres');
	let pgPassword = $state(init.pgPassword || '');
	let pgDatabase = $state(init.pgDatabase || '');
	let ftpHost = $state(init.ftpHost || '');
	let ftpPort = $state(init.ftpPort || '21');
	let ftpUser = $state(init.ftpUser || '');
	let ftpPassword = $state(init.ftpPassword || '');
	let ftpSecure = $state(init.ftpSecure || false);
	let remoteWebRoot = $state(init.remoteWebRoot || '');
	let siteUrl = $state(init.siteUrl || '');

	const sourceTypes: { value: string; key: TranslationKey; category: 'application' | 'database' | 'storage' }[] = [
		{ value: 'wordpress', key: 'source.type.wordpress', category: 'application' },
		{ value: 'turso', key: 'source.type.turso', category: 'database' },
		{ value: 'mysql-ssh', key: 'source.type.mysql-ssh', category: 'database' },
		{ value: 'postgres-ssh', key: 'source.type.postgres-ssh', category: 'database' },
		{ value: 'vercel-blob', key: 'source.type.vercel-blob', category: 'storage' },
		{ value: 'ssh-sftp', key: 'source.type.ssh-sftp', category: 'storage' },
		{ value: 'ftp', key: 'source.type.ftp', category: 'storage' },
	];

	const needsSsh = $derived(type === 'mysql-ssh' || type === 'postgres-ssh' || type === 'ssh-sftp');
	const needsFtp = $derived(type === 'ftp' || type === 'wordpress');

	const infoWhatKey = $derived(`source.info.${type}.what` as TranslationKey);
	const infoHowKey = $derived(`source.info.${type}.how` as TranslationKey);
	const labelPlaceholder = $derived.by(() => {
		const key = `source.label_placeholder.${type}` as TranslationKey;
		const translated = i18n.t(key);
		// If the key is missing, i18n.t returns the key itself — fall back to a generic example.
		return translated === key ? i18n.t('source.label_placeholder.fallback') : translated;
	});

	function getSshConfig(): Record<string, unknown> {
		return {
			sshHost,
			sshPort: Number(sshPort),
			sshUser,
			...(sshAuthMethod === 'password' ? { sshPassword } : { sshPrivateKey }),
		};
	}

	function getFtpConfig(): Record<string, unknown> {
		return {
			ftpHost,
			ftpPort: Number(ftpPort),
			ftpUser,
			ftpPassword,
			ftpSecure,
		};
	}

	function getConfig(): Record<string, unknown> {
		if (type === 'turso') {
			return { url: tursoUrl, authToken: tursoToken };
		}
		if (type === 'vercel-blob') {
			return { token: blobToken };
		}
		if (type === 'ssh-sftp') {
			return { ...getSshConfig(), remotePath, useSudo };
		}
		if (type === 'mysql-ssh') {
			return {
				...getSshConfig(),
				mysqlHost,
				mysqlPort: Number(mysqlPort),
				mysqlUser,
				mysqlPassword,
				mysqlDatabase,
			};
		}
		if (type === 'postgres-ssh') {
			return {
				...getSshConfig(),
				pgHost,
				pgPort: Number(pgPort),
				pgUser,
				pgPassword,
				pgDatabase,
			};
		}
		if (type === 'ftp') {
			return { ...getFtpConfig(), remotePath };
		}
		if (type === 'wordpress') {
			return { ...getFtpConfig(), remoteWebRoot, siteUrl };
		}
		return {};
	}

	async function testConnection() {
		testing = true;
		try {
			const result = await api.post<{ success: boolean; error?: string }>('/sources/test', {
				type,
				config: getConfig(),
			});
			if (result.success) {
				toast.success(i18n.t('source.test.success'));
			} else {
				toast.error(i18n.t('source.test.error', { error: result.error || '' }));
			}
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			testing = false;
		}
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!label.trim()) return;
		saving = true;

		try {
			if (isEdit && initialSourceId) {
				await api.put(`/sources/${initialSourceId}`, {
					type,
					label: label.trim(),
					config: getConfig(),
				});
				toast.success(i18n.t('source.updated'));
			} else {
				await api.post('/sources', {
					project_id: projectId,
					type,
					label: label.trim(),
					config: getConfig(),
				});
				toast.success(i18n.t('source.created'));
			}
			onCreated();
		} catch (err) {
			toast.error(translateError(err));
		} finally {
			saving = false;
		}
	}
</script>

<form onsubmit={handleSubmit} class="space-y-4">
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.type')}</label>
			<select bind:value={type} disabled={isEdit} class="w-full rounded-lg border border-border bg-bg px-3 py-2 text-white focus:border-accent focus:outline-none disabled:opacity-60">
				<optgroup label={i18n.t('source.group.application')}>
					{#each sourceTypes.filter(s => s.category === 'application') as st}
						<option value={st.value}>{i18n.t(st.key)}</option>
					{/each}
				</optgroup>
				<optgroup label={i18n.t('source.group.database')}>
					{#each sourceTypes.filter(s => s.category === 'database') as st}
						<option value={st.value}>{i18n.t(st.key)}</option>
					{/each}
				</optgroup>
				<optgroup label={i18n.t('source.group.storage')}>
					{#each sourceTypes.filter(s => s.category === 'storage') as st}
						<option value={st.value}>{i18n.t(st.key)}</option>
					{/each}
				</optgroup>
			</select>
		</div>
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.label')}</label>
			<input bind:value={label} placeholder={labelPlaceholder} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			<p class="mt-0.5 text-xs text-text-dim">{i18n.t('source.label_help')}</p>
		</div>
	</div>

	<!-- How it works -->
	<div class="rounded-lg border border-accent/20 bg-accent/5 p-4">
		<div class="flex items-start gap-2.5">
			<svg class="mt-0.5 h-4 w-4 shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<div class="flex-1 space-y-2 text-xs leading-relaxed text-text">
				<p class="font-semibold text-accent">{i18n.t('source.info.heading')}</p>
				<div>
					<p class="font-medium text-text">{i18n.t('source.info.what_label')}</p>
					<p class="mt-0.5 text-text-dim">{i18n.t(infoWhatKey)}</p>
				</div>
				<div>
					<p class="font-medium text-text">{i18n.t('source.info.how_label')}</p>
					<p class="mt-0.5 whitespace-pre-line text-text-dim">{i18n.t(infoHowKey)}</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Turso -->
	{#if type === 'turso'}
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.turso.url')}</label>
			<input bind:value={tursoUrl} placeholder="libsql://your-db.turso.io" required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
		</div>
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.turso.token')}</label>
			<input bind:value={tursoToken} type="password" placeholder="eyJ..." required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
		</div>
	{/if}

	<!-- Vercel Blob -->
	{#if type === 'vercel-blob'}
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.blob.token')}</label>
			<input bind:value={blobToken} type="password" placeholder="vercel_blob_rw_..." required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			<p class="mt-1 text-xs text-text-dim">
				{i18n.t('source.blob.help')}
			</p>
		</div>
	{/if}

	<!-- SSH common fields -->
	{#if needsSsh}
		<div class="rounded-lg border border-border bg-bg p-4 space-y-3">
			<h3 class="text-sm font-medium text-text">{i18n.t('source.ssh.section')}</h3>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ssh.host')}</label>
					<input bind:value={sshHost} placeholder={i18n.t('source.ssh.host_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ssh.port')}</label>
					<input bind:value={sshPort} type="number" class="w-24 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
				</div>
			</div>
			<div>
				<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ssh.user')}</label>
				<input bind:value={sshUser} placeholder="root" required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			</div>
			<div>
				<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ssh.auth')}</label>
				<div class="flex gap-3">
					<label class="flex items-center gap-1.5 text-sm text-text-dim cursor-pointer">
						<input type="radio" bind:group={sshAuthMethod} value="password" class="accent-accent" />
						{i18n.t('source.ssh.auth.password')}
					</label>
					<label class="flex items-center gap-1.5 text-sm text-text-dim cursor-pointer">
						<input type="radio" bind:group={sshAuthMethod} value="key" class="accent-accent" />
						{i18n.t('source.ssh.auth.key')}
					</label>
				</div>
			</div>
			{#if sshAuthMethod === 'password'}
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ssh.password')}</label>
					<input bind:value={sshPassword} type="password" required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
			{:else}
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ssh.private_key')}</label>
					<textarea bind:value={sshPrivateKey} rows="4" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..." required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-white placeholder-text-dimmer focus:border-accent focus:outline-none resize-none"></textarea>
				</div>
			{/if}
		</div>
	{/if}

	<!-- MySQL via SSH -->
	{#if type === 'mysql-ssh'}
		<div class="rounded-lg border border-border bg-bg p-4 space-y-3">
			<h3 class="text-sm font-medium text-text">{i18n.t('source.mysql.section')}</h3>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.mysql.host')}</label>
					<input bind:value={mysqlHost} placeholder="127.0.0.1" class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
					<p class="mt-0.5 text-xs text-text-dim">{i18n.t('source.mysql.host_help')}</p>
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.mysql.port')}</label>
					<input bind:value={mysqlPort} type="number" class="w-24 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.mysql.user')}</label>
					<input bind:value={mysqlUser} placeholder="root" required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.mysql.password')}</label>
					<input bind:value={mysqlPassword} type="password" class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
			</div>
			<div>
				<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.mysql.database')}</label>
				<input bind:value={mysqlDatabase} placeholder={i18n.t('source.mysql.database_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			</div>
		</div>
	{/if}

	<!-- PostgreSQL via SSH -->
	{#if type === 'postgres-ssh'}
		<div class="rounded-lg border border-border bg-bg p-4 space-y-3">
			<h3 class="text-sm font-medium text-text">{i18n.t('source.postgres.section')}</h3>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.postgres.host')}</label>
					<input bind:value={pgHost} placeholder="127.0.0.1" class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
					<p class="mt-0.5 text-xs text-text-dim">{i18n.t('source.postgres.host_help')}</p>
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.postgres.port')}</label>
					<input bind:value={pgPort} type="number" class="w-24 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.postgres.user')}</label>
					<input bind:value={pgUser} placeholder="postgres" required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.postgres.password')}</label>
					<input bind:value={pgPassword} type="password" class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
			</div>
			<div>
				<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.postgres.database')}</label>
				<input bind:value={pgDatabase} placeholder={i18n.t('source.postgres.database_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			</div>
		</div>
	{/if}

	<!-- SSH SFTP remote path -->
	{#if type === 'ssh-sftp'}
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.sftp.path')}</label>
			<input bind:value={remotePath} placeholder={i18n.t('source.sftp.path_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			<p class="mt-1 text-xs text-text-dim">
				{i18n.t('source.sftp.path_help')}
			</p>
		</div>
		<label class="flex items-center gap-2 cursor-pointer">
			<input type="checkbox" bind:checked={useSudo} class="h-4 w-4 rounded accent-accent" />
			<span class="text-sm text-text">{i18n.t('source.sftp.sudo')}</span>
			<span class="text-xs text-text-dim">{i18n.t('source.sftp.sudo_help')}</span>
		</label>
	{/if}

	<!-- FTP common fields (used by 'ftp' and 'wordpress') -->
	{#if needsFtp}
		<div class="rounded-lg border border-border bg-bg p-4 space-y-3">
			<h3 class="text-sm font-medium text-text">{i18n.t('source.ftp.section')}</h3>
			<div class="grid grid-cols-[1fr_auto] gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ftp.host')}</label>
					<input bind:value={ftpHost} placeholder={i18n.t('source.ftp.host_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ftp.port')}</label>
					<input bind:value={ftpPort} type="number" class="w-24 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white focus:border-accent focus:outline-none" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ftp.user')}</label>
					<input bind:value={ftpUser} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.ftp.password')}</label>
					<input bind:value={ftpPassword} type="password" class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				</div>
			</div>
			<label class="flex items-center gap-2 cursor-pointer">
				<input type="checkbox" bind:checked={ftpSecure} class="h-4 w-4 rounded accent-accent" />
				<span class="text-sm text-text">{i18n.t('source.ftp.secure')}</span>
				<span class="text-xs text-text-dim">{i18n.t('source.ftp.secure_help')}</span>
			</label>
		</div>
	{/if}

	<!-- FTP storage remote path -->
	{#if type === 'ftp'}
		<div>
			<label class="mb-1 block text-sm text-text">{i18n.t('source.ftp.path')}</label>
			<input bind:value={remotePath} placeholder={i18n.t('source.ftp.path_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
			<p class="mt-1 text-xs text-text-dim">
				{i18n.t('source.ftp.path_help')}
			</p>
		</div>
	{/if}

	<!-- WordPress-specific fields -->
	{#if type === 'wordpress'}
		<div class="rounded-lg border border-border bg-bg p-4 space-y-3">
			<h3 class="text-sm font-medium text-text">{i18n.t('source.wordpress.section')}</h3>
			<div>
				<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.wordpress.webroot')}</label>
				<input bind:value={remoteWebRoot} placeholder={i18n.t('source.wordpress.webroot_placeholder')} required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				<p class="mt-0.5 text-xs text-text-dim">{i18n.t('source.wordpress.webroot_help')}</p>
			</div>
			<div>
				<label class="mb-1 block text-xs text-text-dim">{i18n.t('source.wordpress.url')}</label>
				<input bind:value={siteUrl} placeholder="https://example.com" required class="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-white placeholder-text-dimmer focus:border-accent focus:outline-none" />
				<p class="mt-0.5 text-xs text-text-dim">{i18n.t('source.wordpress.url_help')}</p>
			</div>
		</div>
	{/if}

	<div class="flex gap-3">
		<button type="button" onclick={testConnection} disabled={testing} class="rounded-lg border border-border px-4 py-2 text-sm text-text-dim transition hover:bg-card-2 disabled:opacity-50">
			{testing ? i18n.t('source.testing') : i18n.t('source.test')}
		</button>
		<button type="submit" disabled={saving} class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[#1a1208] hover:bg-accent-2 disabled:opacity-50">
			{#if saving}
				{isEdit ? i18n.t('source.submit.editing') : i18n.t('source.submit.adding')}
			{:else}
				{isEdit ? i18n.t('source.submit.edit') : i18n.t('source.submit.add')}
			{/if}
		</button>
	</div>
</form>
