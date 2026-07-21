<main>
    <button type="button" wire:click="increment" data-testid="class-livewire-counter">
        Livewire: {{ $count }}
    </button>

    <div wire:ref="class-widget" wire:ignore data-testid="class-react-root"></div>
</main>

@script
<script lang="tsx" bridge:react="class-widget">
    import { useWire } from "@petecoop/livewire-bridge/react";

    export default function ClassCounter() {
        const $wire = useWire<{ count: number }>();

        return (
            <button
                type="button"
                data-testid="class-react-counter"
                onClick={() => $wire.count++}
            >
                React: {$wire.count}
            </button>
        );
    }
</script>
@endscript
