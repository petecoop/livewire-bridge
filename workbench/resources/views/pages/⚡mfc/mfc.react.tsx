import { useWire } from "@petecoop/livewire-bridge/react";

export const wireRef = "counter-widget";

export default function MultiFileCounter() {
    const $wire = useWire<{ count: number }>();

    return (
        <button
            type="button"
            data-testid="mfc-react-counter"
            onClick={() => $wire.count++}
        >
            React: {$wire.count}
        </button>
    );
}
