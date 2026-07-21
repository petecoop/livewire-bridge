<?php

namespace Tests\Fixtures;

use Livewire\Component;

class ClassCounter extends Component
{
    public int $count = 0;

    public function increment(): void
    {
        $this->count++;
    }

    public function render()
    {
        return view('livewire.class-counter')->layout('layouts.app');
    }
}
