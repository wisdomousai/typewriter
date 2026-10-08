import type { LookName } from '../typewriter/looks';
import type { Flag, Typewriter } from '../typewriter/typewriter';
import { Link } from './link';
import { Printer } from './printer';
import { type Line, LIMITS, type Person, type ServerMessage } from './protocol';
import SPEC from '../typewriter/typewriter.json';

/**
 * The typewriter chat: your own typewriter, on endless paper, printing a room's
 * conversation as it is typed, every typist in their own ink. One person holds the line
 * and types at a time; the others ask to hold it and wait their turn. The flag on the side
 * of the machine says where you stand: green, the line is yours; yellow with a number, your
 * place in line; bordeaux, someone else is typing and you aren't in line; down, nobody is
 * typing.
 *
 * You type into a field kept out of sight on the machine (so a phone's keyboard and input
 * methods work), or click the machine's keys. The markup is chat.astro's.
 */

const FLAGS = {
  yours: { colour: '#2f8f46', label: '', ink: '#f4f4f1' },
  waiting: { colour: '#e6b422', ink: '#111111' },
  busy: { colour: '#6d1a2a', label: '', ink: '#f4f4f1' },
} satisfies Record<string, Flag>;

/** A sentinel in the field, so taking a character back always has something to take. */
const SENTINEL = ' ';

export interface ChatOptions {
  /** The room's WebSocket address. */
  url: string;
  models: string;
  name: () => string;
  look: () => LookName;
  palette: string;
  decor: string[];
  volume: number;
  reducedMotion: boolean;
  /** Where the line stands and who's in the room, for the page to show. */
  onChange?: (view: ChatView) => void;
}

export interface ChatView {
  state: 'connecting' | 'open' | 'closed';
  me: Person | null;
  people: Person[];
  line: Line;
  /** Your place in line (1 is next), or 0. */
  place: number;
  /** The line is yours. */
  mine: boolean;
}

export function setUpChat(root: HTMLElement, opts: ChatOptions) {
  const canvas = root.querySelector('canvas')!;
  const field = root.querySelector<HTMLTextAreaElement>('textarea.keys')!;
  const off = new AbortController();
  const { signal } = off;

  let stage: ReturnType<typeof import('../typewriter/typewriter').mountTypewriter> | null = null;
  let tw: Typewriter | null = null;
  let printer: Printer | null = null;
  let gone = false;
  /** Messages that came before the machine was ready. */
  let early: ServerMessage[] = [];
  const view: ChatView = {
    state: 'connecting',
    me: null,
    people: [],
    line: { floor: null, queue: [], until: null },
    place: 0,
    mine: false,
  };
  let shifted: string | null = null;

  const link = new Link(opts.url, () => ({
    t: 'hello',
    name: opts.name(),
    ink: view.me?.ink ?? stored('typewriter-chat-ink') ?? undefined,
  }));
  link.onState = (state) => {
    view.state = state;
    tell();
  };
  link.onMessage = (m) => {
    if (!printer) early.push(m);
    else hear(m);
  };

  // ---------- The machine ----------

  (async () => {
    try {
      const { mountTypewriter } = await import('../typewriter/typewriter');
      if (gone) return;
      stage = mountTypewriter(canvas, {
        models: opts.models,
        look: opts.look(),
        endless: true,
        volume: opts.volume,
        reducedMotion: opts.reducedMotion,
      });
      tw = stage.typewriter;
      await tw.ready;
      await document.fonts.ready;
      if (gone) return;
      tw.repaint(opts.palette);
      tw.decor(opts.decor);
      printer = new Printer(tw, SPEC.type.columns);
      stage.start();
      listen();
      for (const m of early) hear(m);
      early = [];
      flag();
    } catch (error) {
      console.warn('chat:', error);
      root.dataset.broken = '';
    }
  })();

  // ---------- The room ----------

  function hear(m: ServerMessage) {
    const p = printer!;
    switch (m.t) {
      case 'welcome':
        view.me = m.you;
        view.people = m.people;
        view.line = m.line;
        try {
          localStorage.setItem('typewriter-chat-ink', m.you.ink);
        } catch {}
        tw!.ribbon(m.you.ink);
        p.history(m.history);
        if (m.current) p.begin(m.current, true);
        break;
      case 'people':
        view.people = m.people;
        break;
      case 'line':
        view.line = m.line;
        break;
      case 'turn':
        p.begin(m.turn);
        if (m.turn.id === view.me?.id) {
          tw!.mood('happy');
          field.focus({ preventScroll: true });
        } else tw!.ding();
        break;
      case 'type':
        if (m.id !== view.me?.id) p.type(m.s);
        break;
      case 'back':
        if (m.id !== view.me?.id) p.back();
        break;
      case 'end':
        p.end();
        break;
      case 'error':
        console.warn('chat:', m.message);
        break;
    }
    tell();
  }

  /** Work out where you stand, raise the right flag, and tell the page. */
  function tell() {
    const id = view.me?.id;
    view.mine = !!id && view.line.floor === id;
    view.place = id ? view.line.queue.indexOf(id) + 1 : 0;
    flag();
    caret();
    opts.onChange?.(view);
  }

  function flag() {
    if (!tw) return;
    if (view.mine) tw.flag(FLAGS.yours);
    else if (view.place) tw.flag({ ...FLAGS.waiting, label: String(view.place) });
    else if (view.line.floor) tw.flag(FLAGS.busy);
    else tw.flag(null);
  }

  function caret() {
    if (!tw || !printer) return;
    tw.caret(view.mine ? printer.spot : null);
    tw.mood(view.mine ? 'typing' : 'idle');
  }

  // ---------- Typing ----------

  /** You typed: on your paper at once, and out to the room. */
  function type(s: string) {
    if (!view.mine || !printer || !s) {
      if (s && tw) tw.mood('puzzled');
      return;
    }
    printer.type(s);
    for (let i = 0; i < s.length; i += LIMITS.chunk) link.send({ t: 'type', s: s.slice(i, i + LIMITS.chunk) });
    caret();
  }

  function back() {
    if (!view.mine || !printer) return;
    printer.back();
    link.send({ t: 'back' });
    caret();
  }

  const reset = () => {
    field.value = SENTINEL;
    field.setSelectionRange(1, 1);
  };
  reset();
  field.addEventListener(
    'input',
    (e) => {
      if ((e as InputEvent).isComposing) return;
      const v = field.value;
      if (!v.startsWith(SENTINEL)) back();
      else type(v.slice(SENTINEL.length).replace(/\r\n?/g, '\n'));
      reset();
    },
    { signal },
  );
  field.addEventListener('compositionend', () => field.dispatchEvent(new Event('input')), { signal });
  field.addEventListener(
    'keydown',
    (e) => {
      // Escape hands the line on.
      if (e.key === 'Escape' && view.mine) {
        e.preventDefault();
        over();
      }
    },
    { signal },
  );

  function listen() {
    canvas.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
    canvas.addEventListener(
      'pointermove',
      (e) => {
        const n = stage!.ndc(e);
        tw!.look(n);
        canvas.style.cursor = tw!.keyAt(n, stage!.camera) ? 'pointer' : '';
      },
      { signal },
    );
    canvas.addEventListener('pointerleave', () => tw?.look(null), { signal });
    // A key clicked types what it types; anywhere else on the machine, back to typing.
    canvas.addEventListener(
      'click',
      (e) => {
        field.focus({ preventScroll: true });
        const key = tw!.keyAt(stage!.ndc(e), stage!.camera);
        if (key) press(key.id, key.keys, e.shiftKey ? 1 : e.altKey ? 2 : 0);
      },
      { signal },
    );
  }

  function press(id: string, keys: string[], mod: number) {
    switch (id) {
      case 'shiftL':
      case 'shiftR':
      case 'lock':
        if (shifted) tw!.hold(shifted, false);
        shifted = shifted === id ? null : id;
        if (shifted) tw!.hold(shifted, true);
        return;
      case 'back':
        return back();
      case 'ret':
        return type('\n');
      case 'space':
        return type(' ');
      case 'tab':
        return;
    }
    if (!mod && shifted) mod = 1;
    if (shifted && shifted !== 'lock') {
      tw!.hold(shifted, false);
      shifted = null;
    }
    type(keys[mod] ?? keys[0] ?? '');
  }

  // ---------- The line ----------

  function hold() {
    link.send({ t: 'hold' });
    field.focus({ preventScroll: true });
  }
  function leave() {
    link.send({ t: 'leave' });
  }
  function over() {
    link.send({ t: 'over' });
  }

  return {
    get view() {
      return view;
    },
    get typewriter() {
      return tw;
    },
    get stage() {
      return stage;
    },
    hold,
    leave,
    over,
    /** Type into the chat (as if from the keyboard). */
    focus() {
      field.focus({ preventScroll: true });
    },
    /** A new name: said to the room at once. */
    rename() {
      link.rehello();
    },
    relook() {
      tw?.dress(opts.look());
    },
    repaint(palette: string) {
      opts.palette = palette;
      tw?.repaint(palette);
      if (view.me) tw?.ribbon(view.me.ink);
    },
    decor(names: string[]) {
      opts.decor = names;
      tw?.decor(names);
    },
    setVolume(v: number) {
      stage?.sounds.setVolume(v);
    },
    dispose() {
      gone = true;
      off.abort();
      link.close();
      stage?.dispose();
    },
  };
}

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
