---
name: typewriter
description: Put the robot typewriter or teleprinter (github:wisdomousai/typewriter) in a web page, type or print text on it from code, send a telegram as a link, or set up the typewriter chat on Cloudflare. Use when someone wants a 3D typewriter, a teleprinter, a typed-out message or the typewriter chat in their site.
---

# Robot typewriter and teleprinter

Two three.js machines, each on a canvas of its own, and a chat that runs on a Cloudflare
Worker. Live demos: https://wisdomousai.github.io/typewriter/ (also `chat/`, `duet/`,
`teleprinter/`).

## Install

```sh
bun add github:wisdomousai/typewriter three
mkdir -p public/models && cp node_modules/typewriter/public/models/*.glb public/models/
```

The modules are TypeScript that import JSON: use a bundler (Vite, Astro, Next, Bun). For the
paper's type, load Maple Mono: `import '@fontsource/maple-mono/400.css'`.

## A typewriter

```ts
import { mountTypewriter } from 'typewriter/typewriter';

const { typewriter, start, dispose } = mountTypewriter(canvas, {
  models: '/models/',     // where typewriter.glb is served
  look: 'colour',         // 'ink' | 'paper' | 'colour'
  layout: 'us-qwerty',    // see LAYOUTS in 'typewriter/layouts', or { name, rows } of your own
  endless: true,          // a roll instead of sheets
  volume: 0.7,            // 0 is silent
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
start();
await typewriter.ready;
// Characters go into a queue and are typed at the machine's pace.
'Hello'.split('').forEach((ch, col) => typewriter.strike(ch, { line: 0, col }));
typewriter.move({ line: 1, col: 0 }); // carriage return and line feed
```

`dispose()` takes it down. Give the canvas a size in CSS: the camera frames the machine to
whatever the canvas is, and closes in on the paper when it's small.

## A teleprinter

```ts
import { mountTeleprinter } from 'typewriter/teleprinter';
import { Wire } from 'typewriter/telegram';

const { teleprinter, start } = mountTeleprinter(canvas, { models: '/models/', volume: 0.7 });
start();
const wire = new Wire(teleprinter);
await wire.send({ text: 'Arriving Tuesday', from: 'Ada', ink: '#b8322a' }); // resolves when printed
```

Telegrams print one at a time, in order, in capitals, with a faint header (time and sender).

## A telegram as a link

No code at all: the demo page prints whatever the address carries.

```
https://wisdomousai.github.io/typewriter/teleprinter/?m=<message, URL-encoded>&from=<sender>
```

## The chat on your own Cloudflare account

From a clone of the repo, with `npx wrangler login` done:

1. Add the site's origin to `ORIGINS` in `chat/src/index.ts`.
2. `DOMAINS=<your domain> sh chat/setup.sh` (once): Turnstile widget, the Worker's secrets,
   the site key in `.env.production`. It writes secrets, so the person runs it themselves.
3. `bun run chat:deploy`, then set `PUBLIC_CHAT_URL=wss://<worker>.workers.dev` in
   `.env.production` and build.

`MAX_SESSIONS` in `chat/wrangler.jsonc` caps machines across all rooms (10 by default).
