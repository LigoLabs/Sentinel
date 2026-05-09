<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';

	const typeStyles: Record<string, string> = {
		success: 'border-success/30 bg-success/10 text-success',
		error: 'border-danger/30 bg-danger/10 text-danger',
		info: 'border-accent/30 bg-accent/10 text-accent',
	};
</script>

{#if toast.items.length > 0}
	<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
		{#each toast.items as item (item.id)}
			<div class="animate-slide-in rounded-lg border px-4 py-3 text-sm shadow-lg {typeStyles[item.type]}">
				<div class="flex items-center gap-2">
					<span>{item.message}</span>
					<button onclick={() => toast.remove(item.id)} class="ml-2 opacity-60 hover:opacity-100">&times;</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	@keyframes slide-in {
		from { opacity: 0; transform: translateX(1rem); }
		to { opacity: 1; transform: translateX(0); }
	}
	.animate-slide-in {
		animation: slide-in 0.2s ease-out;
	}
</style>
