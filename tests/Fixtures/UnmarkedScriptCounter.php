<?php

namespace Tests\Fixtures;

use Livewire\Component;

class UnmarkedScriptCounter extends Component
{
    public int $count = 0;

    public function increment(): void
    {
        $this->count++;
    }

    public function render()
    {
        return view('livewire.unmarked-script-counter')->layout('layouts.app');
    }
}
