---
name: typewriter
description: Add the robot typewriter or teleprinter (package github:wisdomousai/typewriter, three.js) to a website — a hero that types a line, a contact form typed onto paper, or a teleprinter that prints messages or notifications. Use when someone wants a 3D/animated typewriter, teleprinter or typed-out text in their own site or app.
---

# The robot typewriter in your site

Two machines, each drawn on a canvas of its own with three.js: the **typewriter** (keys,
typebars, carriage, sheets or endless paper) and the **teleprinter** (prints telegrams on a
roll). Everything below goes into the user's site; nothing depends on the project's demo
pages.

## 1. Install and serve the models

```sh
bun add github:wisdomousai/typewriter three        # npm i / pnpm add work the same
```

Copy the models where the site serves static files, and point `models` at that URL:

| Framework | Copy to | `models` |
| --- | --- | --- |
| Astro, Vite, SvelteKit (`static/`) | `public/models/` | `'/models/'` (prefix the site's base path if it has one) |
| Next.js | `public/models/` | `'/models/'` |

```sh
mkdir -p public/models && cp node_modules/typewriter/public/models/*.glb public/models/
```

Add the copy to a `postinstall` script, or check the files in, so a fresh install keeps them.

The modules are TypeScript and import JSON: Vite, Astro, SvelteKit and Bun handle that as is.
**Next.js** needs `transpilePackages: ['typewriter']` in `next.config`.

The paper is typed in Maple Mono when the page has it: `import '@fontsource/maple-mono/400.css'`
(or the site's own `@font-face` named "Maple Mono"). Without it, the system monospace.

## 2. Ground rules

- **Browser only.** three.js needs `window` and WebGL. Import and mount on the client: an
  Astro `<script>`, a React `useEffect` (with `'use client'` in Next), Svelte `onMount`, Vue
  `onMounted`. Never during server rendering.
- **Size the canvas with CSS** (say `width: 100%; aspect-ratio: 4 / 3`). The camera frames the
  whole machine on a big canvas and closes in on the paper when the type would be too small.
- **One canvas per machine.** Several on a page are fine; each stops drawing while off screen.
- **Clean up.** Call `dispose()` on what `mount…` returned when the component unmounts.
- **Respect reduced motion**: pass `reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches`.
- **WebGL can fail** (old devices, blocked GPU): wrap the mount in `try`, and show the
  text plainly instead.
- Wait for `machine.ready` before anything that needs the model; queued typing may start at once.

## 3. Recipes

### A hero that types a line

```ts
import { mountTypewriter } from 'typewriter/typewriter';

const stage = mountTypewriter(canvas, {
  models: '/models/',
  look: 'colour',        // 'ink' | 'paper' | 'colour'
  endless: true,         // a roll; false for sheets
  volume: 0,             // silent until the visitor asks for sound
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
stage.start();
const tw = stage.typewriter;
tw.repaint('navy');      // typewriter | mustard | navy | coral | lilac | graphite | cream

// Everything is queued and typed at the machine's own pace.
const lines = ['Hello.', 'We build things.'];
lines.forEach((text, line) => {
  [...text].forEach((ch, col) => tw.strike(ch, { line, col }));
  tw.move({ line: line + 1, col: 0 }); // carriage return and line feed
});
```

React:

```tsx
'use client';
import { useEffect, useRef } from 'react';

export function Typewriter() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let stage: { dispose(): void } | undefined;
    let gone = false;
    import('typewriter/typewriter').then(({ mountTypewriter }) => {
      if (gone || !ref.current) return;
      const s = mountTypewriter(ref.current, { models: '/models/', endless: true, volume: 0 });
      s.start();
      'Hello.'.split('').forEach((ch, col) => s.typewriter.strike(ch, { line: 0, col }));
      stage = s;
    });
    return () => {
      gone = true;
      stage?.dispose();
    };
  }, []);
  return <canvas ref={ref} style={{ width: '100%', aspectRatio: '4 / 3' }} aria-hidden />;
}
```

The dynamic `import()` keeps three.js out of the first bundle and off the server.

### A contact form typed onto the paper

`setUpDesk` puts a real form on the machine: what the visitor types in the fields is typed onto
the paper, the fields stay accessible (screen readers, autofill, a phone's keyboard), and a
*Plain form* button shows the fields themselves.

1. Copy the markup from `node_modules/typewriter/src/components/Typewriter.astro` (in Astro,
   import that component as is). Keep the class names, the `data-label`/`data-top`/
   `data-lines` attributes and the `data-action` buttons; field names and labels can change.
2. `import 'typewriter/desk.css'`.
3. Mount it:

```ts
import { setUpDesk } from 'typewriter/desk';

const desk = setUpDesk(document.querySelector('.desk')!, {
  models: '/models/',
  look: () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'paper' : 'ink'),
  endless: false,
  volume: 0.7,
});
```

The desk stops the form from submitting by itself. **Sending is the site's job**: add a send
button, read `new FormData(desk form)` (fields `to`, `from`, `message` by default) and post it
to the site's own form backend. Ask the user which backend; don't pick one for them.

### A teleprinter that prints messages

```ts
import { mountTeleprinter } from 'typewriter/teleprinter';
import { Wire } from 'typewriter/telegram';

const stage = mountTeleprinter(canvas, { models: '/models/', look: 'colour', volume: 0.5 });
stage.start();
const wire = new Wire(stage.teleprinter);
await wire.send({ text: 'Order 1042 shipped', from: 'Shop', ink: '#1f4fa8' });
```

Each telegram is dialled in, rings twice, gets a faint header (the time and `from`), and prints
in capitals, wrapped at spaces. They print one at a time in order; `send` resolves when one is
on the paper. Feed it from anything: a form, a WebSocket, server-sent events, or the page's
own address (read `?m=` yourself to make shareable telegram links). `teleprinter.online = true`
lights its line lamp.

## 4. Reference

- Typewriter layouts: `LAYOUTS` in `typewriter/layouts` (`us-qwerty`, `uk-qwerty`,
  `de-qwertz`, `ch-qwertz`, `fr-azerty`, `es-qwerty`, `dvorak`, `emoji`), or a layout of your
  own: `{ name, rows }`, four rows of 11, 12, 12 and 11 keys, each key the characters it types
  (plain, Shift, Alt Gr).
- Looks: `'ink'`, `'paper'`, `'colour'`; switch live with `machine.dress(look)`.
- Sound volume: `stage.sounds.setVolume(0..1)`. Sounds are synthesised; no audio files to serve.
- Typewriter: `strike(ch, at, ink?)`, `move(at)`, `ding()`, `erase(at)`, `ribbon(ink)`,
  `repaint(palette)`, `decor(names)`, `mood('idle' | 'typing' | 'happy' | 'puzzled' | 'asleep')`. A spot is `{ line, col }`.
- Teleprinter: `strike`, `move`, `ding(times)`, `dial(digits)`, `wait(seconds)`, `done()`,
  `columns` (32 per line); usually through `Wire`.
