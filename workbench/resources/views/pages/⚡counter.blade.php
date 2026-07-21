<?php

use Livewire\Component;

new class extends Component {
    public int $count = 0;
    public int $ignored = 0;
    public array $profile = ['name' => 'Taylor'];

    public function increment(): void
    {
        $this->count++;
    }
};
?>

<main>
    <button type="button" wire:click="increment" data-testid="livewire-counter">
        Livewire: {{ $count }}
    </button>
    <button type="button" @click="$wire.count++" x-text="'Alpine: ' + $wire.count"
        data-testid="alpine-counter"></button>
    <button type="button" @click="$wire.ignored++" x-text="'Ignored: ' + $wire.ignored"
        data-testid="ignored-counter"></button>
    <button type="button" @click="$wire.profile.name = 'Sam'" data-testid="nested-mutation">
        Change nested value
    </button>
    <a href="/other" wire:navigate data-testid="navigate-away">Navigate away</a>

    <div wire:ref="app" wire:ignore data-testid="react-root"></div>
</main>

<script lang="tsx" data-react="app">
    import { useRef } from "react";
    import { useWire } from "@petecoop/livewire-bridge/react";

    type FixtureWire = {
        count: number;
        profile: { name: string };
    };

    export default function BrowserFixture() {
        const $wire = useWire<FixtureWire>();
        const renders = useRef(0);
        renders.current++;

        return (
            <section>
                <button type="button" onClick={() => $wire.count++} data-testid="react-counter">
                    React: {$wire.count}
                </button>
                <p data-testid="react-profile">Profile: {$wire.profile.name}</p>
                <p data-testid="react-render-count">Renders: {renders.current}</p>
            </section>
        );
    }
</script>
