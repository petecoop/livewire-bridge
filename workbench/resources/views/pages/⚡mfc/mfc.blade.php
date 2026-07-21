<main>
    <button type="button" wire:click="increment" data-testid="mfc-livewire-counter">
        Livewire: {{ $count }}
    </button>

    <div wire:ref="counter-widget" wire:ignore data-testid="mfc-react-root"></div>
</main>
