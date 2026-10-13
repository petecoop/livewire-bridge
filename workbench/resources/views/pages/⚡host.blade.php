<?php

use Livewire\Component;

new class extends Component {
    public bool $show = false;
    public bool $showOther = false;
};
?>

<main>
    <button wire:click="$toggle('show')" data-testid="toggle-child">Toggle child</button>
    <button wire:click="$toggle('showOther')" data-testid="toggle-other">Toggle other child</button>
    @if ($show)
        @livewire('pages::counter', [], key('counter'))
    @endif
    @if ($showOther)
        @livewire('pages::mfc', [], key('mfc'))
    @endif
</main>
