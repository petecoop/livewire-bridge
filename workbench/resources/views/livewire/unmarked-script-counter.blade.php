<main>
    <button type="button" wire:click="increment" data-testid="unmarked-script-livewire-counter">
        Livewire: {{ $count }}
    </button>

    <button
        type="button"
        wire:click="$js.increment"
        x-text="'Alpine: ' + $wire.count"
        data-testid="unmarked-script-wire-counter"
    ></button>
</main>

@script
<script>
    $js('increment', () => $wire.count++);
</script>
@endscript
