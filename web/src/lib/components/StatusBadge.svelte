<script lang="ts">
	import { i18n } from '$lib/i18n/index.svelte';
	import type { TranslationKey } from '$lib/i18n/dict';

	let { status }: { status: string } = $props();

	const styles: Record<string, string> = {
		success: 'bg-success/15 text-success',
		running: 'bg-accent/15 text-accent',
		failed: 'bg-danger/15 text-danger',
		partial: 'bg-warning/15 text-warning',
	};

	const KEYS: Record<string, TranslationKey> = {
		success: 'status.success',
		running: 'status.running',
		failed: 'status.failed',
		partial: 'status.partial',
	};

	const label = $derived(KEYS[status] ? i18n.t(KEYS[status]) : status);
</script>

<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {styles[status] || 'bg-border text-text-dim'}">
	<span class="h-1.5 w-1.5 rounded-full {status === 'running' ? 'animate-pulse' : ''}"
		style="background: currentColor;"></span>
	{label}
</span>
