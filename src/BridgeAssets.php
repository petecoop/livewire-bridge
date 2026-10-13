<?php

namespace LivewireBridge;

use Illuminate\Support\Facades\Vite;
use Livewire\Component;

use function Livewire\store;

class BridgeAssets
{
    public static function entry(string $path): string
    {
        return Vite::isRunningHot()
            ? '@livewire-bridge/'.rtrim(strtr(base64_encode($path), '+/', '-_'), '=')
            : $path.'.livewire-entry.tsx';
    }

    public static function url(string $path): string
    {
        return Vite::asset(static::entry($path));
    }

    /** Register individual tags so shared dependencies deduplicate across components. */
    public static function register(Component $component, string $path): void
    {
        // Delegate manifest traversal, CSS ordering, custom build paths, asset URLs,
        // integrity and CSP attributes to Laravel's configured Vite instance.
        $html = (string) Vite::getFacadeRoot()(static::entry($path));
        preg_match_all('/<link\b[^>]*>|<script\b[^>]*>.*?<\/script>/s', $html, $matches);

        foreach ($matches[0] as $tag) {
            // Ignore per-request CSP nonces when identifying an asset.
            $identity = preg_replace('/\snonce=("[^"]*"|\'[^\']*\')/', '', $tag);
            store($component)->push('assets', $tag, 'livewire-bridge-'.hash('sha256', $identity));
        }
    }

    public static function blade(string $path, bool $insideScript = false): string
    {
        $source = var_export($path, true);
        $script = <<<'BLADE'
<script>
    let active = true;
    const instance = $wire.__instance;
    const component = typeof instance === 'function' ? instance() : instance;
    const removeCleanup = component.addCleanup(() => { active = false; });
    import({!! json_encode(\LivewireBridge\BridgeAssets::url(SOURCE), JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) !!})
        .then(({ run }) => {
            if (active && component.el.isConnected) return run.call($wire, $wire, $js);
        })
        .catch(error => { if (active) console.error('Livewire bridge failed to load', error); })
        .finally(() => removeCleanup());
</script>
BLADE;
        $script = str_replace('SOURCE', $source, $script);
        $register = '@php(\LivewireBridge\BridgeAssets::register($this, '.$source.'))';

        return $register."\n".($insideScript ? $script : "@script\n".$script."\n@endscript");
    }
}
