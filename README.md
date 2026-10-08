# Typewriter

A robot typewriter that types in your browser. Every key you press goes down on the machine,
a typebar swings up out of the basket and hits the platen, the ribbon guide jumps, the letter
lands on the paper a little off its cell (the way a ribbon really leaves it), and the carriage
steps on. Type to the end of a line and the bell rings; press Enter and the carriage gets thrown
back, picks up speed and bangs into the margin stop.

**[Try it →](https://wisdomousai.github.io/typewriter/)**

It is an experiment, and still moving.

## What you can play with

- **Keyboards.** QWERTY (US and UK), QWERTZ (German and Swiss), AZERTY, Spanish, Dvorak, and
  one made of emoji. The legends on the keycaps are drawn live, so switching layouts relabels
  the machine in place.
- **Click the keys.** Every key on the machine works with the mouse too: Shift holds down for
  the next character, Shift Lock stays down until you click it again, and the return key
  throws the carriage back.
- **Emoji.** Pick the emoji keyboard and your own keys type 😀 🐶 🍕 🚀 by where they are, not by
  what they say. Emoji land on the paper like rubber stamps, in colour or in the ribbon's ink.
- **Looks.** Ink, paper or colour, with a two-tone ribbon in the colour look.
- **Sound.** Keys, typebars, the escapement, the platen's ratchet, the bell, the return and
  tearing the sheet off. All of it is made in the page, with no audio files.
- **Tear off** the sheet when you're done (it flies away and a fresh one feeds in), or save it
  as a picture first.

Settings go in the address, so you can share a link to an emoji typewriter in colour:
`?layout=emoji&look=colour`.

## How it's made

**The machine is built in code.** `blender/typewriter.py` builds the whole typewriter in
Blender out of simple shapes: chassis, 53 keys on piston stems, 46 typebars on a half-round
segment, ribbon spools, carriage, platen, bell. Each moving part gets its own bone, and each
bone turns about its own X axis. That way the page can pose any part the same way: pick a bone,
pick an angle. The model ships with no animation clips at all.

**Everything moves live.** Each frame, the page decides where every part should be, and springs
take it there. The physics runs in fixed steps of 1/120 s, so the machine moves the same at
20 fps as it does at 144. A strike is a short chain of events:

1. Shift drops the typebar basket if it's needed.
2. The key dips.
3. The bar swings up and hits. Several bars can be in the air at once.
4. The character lands on the paper at the moment of impact.
5. The spools tick round, and the escapement lets the carriage on one column.

A carriage return is different. The lever turns the platen first, then the carriage
picks up speed along the rail. The rack's teeth buzz past the pawl, and the carriage hits the
stop hard enough to bounce. If you paste a paragraph, the queue speeds up so the machine never
falls far behind.

**The paper is a canvas.** The sheet is a strip laid along the paper's real path: off the roll,
over the table, round the platen and up past the bail. Its texture slides as the platen
turns, so typed lines travel round and up. Corrections are drawn as correction tape over a
faint ghost of the old letter.

**The sounds are synthesised.** Each sound is a few milliseconds of filtered noise and damped
tones, built once when the page loads (`src/typewriter/sound.ts`). Every play wanders a little
in pitch and level, so no two keystrokes sound alike.

**The form is real.** The paper is a front for ordinary form fields. Screen readers,
autofill and a phone's keyboard all work, and *Plain form* shows the fields themselves.

## Running it

```sh
bun install
bun run dev        # http://localhost:5214/typewriter/
bun run build      # the static site, into dist/
```

To change the machine itself, edit `blender/typewriter.py` and run `bun run model` (needs
Blender; it is built with 5.1). It rebuilds `public/models/typewriter.glb` and writes the measurements
the page needs into `src/typewriter/typewriter.json`.

### A layout of your own

A layout is four rows of keys, 11, 12, 12 and 11 long (`src/typewriter/layouts.ts`). Each key is
the characters it types: plain, then with Shift, then with Alt Gr.

```ts
import { mountTypewriter } from './src/typewriter/typewriter';

mountTypewriter(canvas, {
  models: '/models/',
  layout: {
    name: 'Mine',
    rows: [
      ['1!', '2@', '3#', '4$', '5%', '6^', '7&', '8*', '9(', '0)', '-_'],
      [...'qwertyuiop'.split(''), '[{', ']}'],
      [...'asdfghjkl'.split(''), ';:', '\'"', '\\|'],
      ['=+', ...'zxcvbnm'.split(''), ',<', '.>', '/?'],
    ],
  },
});
```

A lone letter types its own capital with Shift. Set `follow: 'position'` and the computer's
keys type whatever sits in the same place on the machine, which is how the emoji keyboard works.

## Licence

MIT
