import type { Camera } from 'three';
import { split, typedAt } from './layouts';
import { type Field, fits, Letter } from './letter';
import type { LookName } from './looks';
import type { Spot, Typewriter, TypewriterOptions } from './typewriter';

/**
 * A form on the robot typewriter (typewriter.ts): its fields are typed onto the paper, a key
 * and a typebar for every character. The fields themselves stay in the page, unseen while the
 * typewriter is out, so screen readers, autofill and a phone's keyboard work as with any
 * form; "Plain form" shows them instead. Nothing is sent anywhere: "Tear off" pulls the
 * sheet out of the machine and feeds a fresh one, and "Save" keeps a picture of it.
 *
 * The markup is Typewriter.astro's; desk.css is its look.
 */

const STORE = 'typewriter-form';

/** The letter's fields: where each goes on the sheet (its label's line, and how many lines
 * the text may take), and the input's own attributes. In order down the sheet. */
export const FIELDS = [
  { name: 'to', label: 'To', top: 1, lines: 1, attrs: { autocomplete: 'off', maxlength: '24' } },
  { name: 'from', label: 'From', top: 4, lines: 1, attrs: { autocomplete: 'name', maxlength: '24' } },
  { name: 'message', label: 'Message', top: 7, lines: 56, attrs: { rows: '8', maxlength: '1344' } },
] as const;

export type Mode = 'typewriter' | 'plain';

/** The typewriter, unless this browser asked for the plain form. */
export function storedMode(): Mode {
  try {
    return localStorage.getItem(STORE) === 'plain' ? 'plain' : 'typewriter';
  } catch {
    return 'typewriter';
  }
}

type Stage = ReturnType<typeof import('./typewriter').mountTypewriter>;

export interface DeskOptions extends Omit<TypewriterOptions, 'look'> {
  /** The machine's look now (asked again on relook()). */
  look: () => LookName;
  /** Told when the machine is up (or null, when it couldn't be). */
  onReady?: (typewriter: Typewriter | null) => void;
}

/** Bring a desk to life: the typewriter (unless the plain form was asked for), and the paper
 * following the fields. */
export function setUpDesk(desk: HTMLElement, opts: DeskOptions) {
  const canvas = desk.querySelector('canvas')!;
  const form = desk.querySelector('form')!;
  const toggle = desk.querySelector<HTMLButtonElement>('[data-action="mode"]')!;
  const tear = desk.querySelector<HTMLButtonElement>('[data-action="tear"]')!;
  const save = desk.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const fields: Field[] = [
    ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-label]'),
  ].map((el) => ({
    el,
    label: el.dataset.label!,
    top: Number(el.dataset.top),
    lines: Number(el.dataset.lines),
  }));
  // On endless paper the last field runs on as far as it likes.
  const end = fields[fields.length - 1];
  end.el.dataset.maxlength ??= end.el.getAttribute('maxlength') ?? '';
  if (opts.endless) {
    end.lines = Infinity;
    end.el.removeAttribute('maxlength');
  } else if (end.el.dataset.maxlength) end.el.setAttribute('maxlength', end.el.dataset.maxlength);
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const off = new AbortController();
  const { signal } = off;

  let stage: Stage | null = null;
  let tw: Typewriter | null = null;
  let letter: Letter | null = null;
  let mounting: Promise<void> | null = null;
  let last: Field = fields[0];
  /** No field has the focus (the machine has been sent to wait). */
  let away = false;
  let gone = false;
  let tearing = false;
  /** Shift clicked on the machine (for the next character), and Shift Lock. */
  let shifted: string | null = null;
  let locked = false;
  /** Each field's value and selection before the edit under way, to put back if the
   * edit doesn't fit on the paper. */
  const before = new Map<Field, { value: string; start: number; end: number }>();
  const remember = (f: Field) =>
    before.set(f, {
      value: f.el.value,
      start: f.el.selectionStart ?? 0,
      end: f.el.selectionEnd ?? 0,
    });

  const typing = () => desk.dataset.mode === 'typewriter' && !!letter;
  const focused = () => fields.find((f) => f.el === document.activeElement) ?? null;

  // ---------- The typewriter ----------

  function mount() {
    mounting ??= (async () => {
      try {
        const { mountTypewriter } = await import('./typewriter');
        if (gone) return;
        const { look, onReady: _, ...rest } = opts;
        stage = mountTypewriter(canvas, {
          ...rest,
          look: look(),
          reducedMotion: opts.reducedMotion ?? still.matches,
        });
        listen();
        tw = stage.typewriter;
        await tw.ready;
        await document.fonts.ready;
        if (gone) return;
        letter = new Letter(tw, fields);
        letter.start();
        away = false;
        if (desk.dataset.mode === 'typewriter') stage.start();
        caret();
        opts.onReady?.(tw);
      } catch (error) {
        // No WebGL, or the model didn't load: the plain form it is.
        console.warn('typewriter:', error);
        stage?.dispose();
        stage = tw = letter = null;
        desk.dataset.mode = 'plain';
        toggle.hidden = tear.hidden = save.hidden = true;
        opts.onReady?.(null);
      }
    })();
    return mounting;
  }

  function setMode(mode: Mode) {
    desk.dataset.mode = mode;
    toggle.textContent = mode === 'plain' ? 'Typewriter' : 'Plain form';
    try {
      localStorage.setItem(STORE, mode);
    } catch {}
    if (mode === 'plain') return stage?.stop();
    if (!letter) return void mount();
    // Catch the paper up with whatever was written on the plain form.
    fields.forEach((f) => letter!.change(f));
    stage!.start();
    caret();
  }

  /** Show the caret on the paper, and keep the focused field under it, so a phone's
   * keyboard and an input method's popup open where the typing is. */
  function caret() {
    if (!typing() || tearing) return;
    const f = focused();
    tw!.mood(f ? 'typing' : 'idle');
    if (!f) {
      tw!.caret(null);
      if (!away) letter!.park();
      away = true;
      return;
    }
    away = false;
    const at = letter!.caretOf(f);
    tw!.caret(at);
    keep(f, at);
  }

  /** Keep a field where its caret is on the sheet. */
  function keep(f: Field, at: Spot) {
    const p = tw!.project(at, stage!.camera);
    f.el.style.setProperty('--x', `${((p.x + 1) / 2) * canvas.clientWidth}px`);
    f.el.style.setProperty('--y', `${((1 - p.y) / 2) * canvas.clientHeight}px`);
  }

  function listen() {
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!typing()) return;
        const n = stage!.ndc(e);
        tw!.look(n);
        const at = tw!.pick(n, stage!.camera);
        canvas.style.cursor = tw!.keyAt(n, stage!.camera)
          ? 'pointer'
          : at && letter!.fieldAt(at)
            ? 'text'
            : '';
      },
      { signal },
    );
    canvas.addEventListener('pointerleave', () => tw?.look(null), { signal });
    // The field keeps the focus while the machine is clicked, so its caret stays put.
    canvas.addEventListener('mousedown', (e) => typing() && e.preventDefault(), { signal });
    // A click on a key presses it; on the paper it puts the caret there; anywhere else on
    // the machine goes back to the field last typed in.
    canvas.addEventListener(
      'click',
      (e) => {
        if (!typing()) return;
        const n = stage!.ndc(e);
        const key = tw!.keyAt(n, stage!.camera);
        if (key) return press(key.id, key.keys, e.shiftKey ? 1 : e.altKey ? 2 : 0);
        const at = tw!.pick(n, stage!.camera);
        const f = (at && letter!.fieldAt(at)) || last;
        const i = at && letter!.fieldAt(at) ? letter!.indexAt(f, at) : f.el.value.length;
        f.el.focus({ preventScroll: true });
        f.el.setSelectionRange(i, i);
        caret();
      },
      { signal },
    );
  }

  /** A key of the machine's pressed with the mouse: type what it types into the field. */
  function press(id: string, keys: string[], mod: number) {
    const f = focused() ?? last;
    if (document.activeElement !== f.el) f.el.focus({ preventScroll: true });
    const at = fields.indexOf(f);
    switch (id) {
      case 'shiftL':
      case 'shiftR':
        if (shifted) tw!.hold(shifted, false);
        shifted = shifted === id ? null : id;
        if (shifted) tw!.hold(shifted, true);
        return;
      case 'lock':
        locked = !locked;
        tw!.hold('lock', locked);
        return;
      case 'tab':
        return fields[(at + 1) % fields.length].el.focus({ preventScroll: true });
      case 'ret':
        if (f.el instanceof HTMLInputElement) return fields[at + 1]?.el.focus({ preventScroll: true });
        return insert(f, '\n');
      case 'back':
        return insert(f, '', true);
      case 'space':
        return insert(f, ' ');
    }
    if (!mod && (shifted || locked)) mod = 1;
    const ch = keys[mod] ?? keys[0];
    if (shifted) tw!.hold(shifted, false);
    shifted = null;
    if (ch) insert(f, ch);
  }

  /** Type into a field as its keys would: over the selection, or (back) take out the
   * selection or the character before the caret. */
  function insert(f: Field, text: string, back = false) {
    remember(f);
    let { start, end } = before.get(f)!;
    if (back && start === end) {
      if (!start) return;
      const head = split(f.el.value.slice(0, start));
      start -= head[head.length - 1].length;
    }
    f.el.setRangeText(text, start, end, 'end');
    f.el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------- The fields ----------

  for (const f of fields) {
    f.el.addEventListener('beforeinput', () => remember(f), { signal });
    f.el.addEventListener(
      'input',
      () => {
        // No more than the paper has lines for.
        const was = before.get(f);
        if (was && !fits(f, f.el.value)) {
          f.el.value = was.value;
          f.el.setSelectionRange(was.start, was.end);
          return;
        }
        if (typing()) letter!.change(f);
        caret();
      },
      { signal },
    );
    f.el.addEventListener(
      'focus',
      () => {
        last = f;
        caret();
      },
      { signal },
    );
    // After the focus has gone wherever it's going.
    f.el.addEventListener('blur', () => requestAnimationFrame(caret), { signal });
    f.el.addEventListener('keyup', caret, { signal });
    (f.el as HTMLElement).addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.isComposing) return;
        // A layout that follows positions types what it has on the key pressed (Alt Gr is
        // Option on a Mac, so either Alt will do).
        const mapped =
          tw && typing() && !e.metaKey && !e.ctrlKey
            ? typedAt(tw.layout, e.code, e.shiftKey, e.altKey)
            : null;
        if (mapped) {
          e.preventDefault();
          return insert(f, mapped);
        }
        // Enter in a one-line field goes on to the next field, as Tab does.
        if (e.key === 'Enter' && f.el instanceof HTMLInputElement) {
          e.preventDefault();
          fields[fields.indexOf(f) + 1]?.el.focus();
        }
      },
      { signal },
    );
  }
  document.addEventListener('selectionchange', caret, { signal });
  form.addEventListener('submit', (e) => e.preventDefault(), { signal });
  const ro = new ResizeObserver(caret);
  ro.observe(canvas);

  // ---------- The sheet ----------

  save.addEventListener(
    'click',
    async () => {
      if (!tw) return;
      tw.paper.flush();
      const blob = await new Promise<Blob | null>((done) =>
        tw!.paper.picture().toBlob(done, 'image/png'),
      );
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `letter-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    { signal },
  );

  tear.addEventListener(
    'click',
    async () => {
      if (!letter || !tw || tearing) return;
      tearing = true;
      tear.disabled = true;
      tw.caret(null);
      tw.mood('happy');
      await tw.send();
      if (gone) return;
      fields.forEach((f) => (f.el.value = ''));
      letter.start();
      tearing = false;
      tear.disabled = false;
      away = false;
      fields[0].el.focus({ preventScroll: true });
      caret();
    },
    { signal },
  );

  // ---------- Mode ----------

  toggle.addEventListener(
    'click',
    () => setMode(desk.dataset.mode === 'plain' ? 'typewriter' : 'plain'),
    { signal },
  );
  toggle.textContent = desk.dataset.mode === 'plain' ? 'Typewriter' : 'Plain form';
  if (desk.dataset.mode === 'typewriter') mount();

  return {
    get typewriter() {
      return tw;
    },
    /** The machine's canvas, camera and renderer, once it is up. */
    get stage() {
      return stage;
    },
    /** Its sounds' volume, 0 to 1. */
    setVolume(v: number) {
      stage?.sounds.setVolume(v);
    },
    /** The page's colours changed: dress the machine for them. */
    relook() {
      tw?.dress(opts.look());
    },
    /** Start typing: into the field last typed in (the first, to begin with). */
    focus() {
      last.el.focus({ preventScroll: true });
    },
    /** The desk is gone from the page: stop the machine and let go of everything. */
    dispose() {
      gone = true;
      off.abort();
      ro.disconnect();
      stage?.dispose();
      stage = tw = letter = null;
    },
  };
}
