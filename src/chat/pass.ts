/**
 * The chat's pass: a machine shows the room a pass to come in, and gets one by passing a
 * captcha (Cloudflare Turnstile) and showing the token to the room's server (POST /pass), which
 * signs a pass good for a couple of hours. This browser keeps it until then, so a reload
 * doesn't ask again.
 *
 * Without PUBLIC_TURNSTILE_SITEKEY the page uses Turnstile's published test key, which every
 * check passes (and which the local server's test secret accepts).
 */

export const SITEKEY: string = import.meta.env?.PUBLIC_TURNSTILE_SITEKEY ?? '1x00000000000000000000AA';
const STORE = 'typewriter-chat-pass';
/** A pass with less than this left is asked for again (ms). */
const MARGIN = 5 * 60 * 1000;

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** The pass this browser has, if it is still good. */
export function storedPass(): string | null {
  try {
    const { pass, until } = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    return typeof pass === 'string' && until - Date.now() > MARGIN ? pass : null;
  } catch {
    return null;
  }
}

export function forgetPass() {
  try {
    localStorage.removeItem(STORE);
  } catch {}
}

let script: Promise<Turnstile> | null = null;
function turnstile(): Promise<Turnstile> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('No captcha.')));
    s.onerror = () => {
      script = null;
      reject(new Error('The captcha would not load.'));
    };
    document.head.append(s);
  });
  return script;
}

/** The captcha in `box`, then a pass for it from the server at `server` (http(s)://). The
 * widget's site key is `sitekey`, or PUBLIC_TURNSTILE_SITEKEY on a Vite build. */
export async function getPass(server: string, box: HTMLElement, sitekey = SITEKEY): Promise<string> {
  const ts = await turnstile();
  box.replaceChildren();
  const token = await new Promise<string>((resolve, reject) => {
    ts.render(box, {
      sitekey,
      theme: 'auto',
      size: 'flexible',
      callback: resolve,
      'error-callback': () => reject(new Error('The captcha failed: reload to try again.')),
    });
  });
  const res = await fetch(`${server.replace(/\/$/, '')}/pass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const body = (await res.json().catch(() => ({}))) as { pass?: string; until?: number; error?: string };
  if (!res.ok || !body.pass) throw new Error(body.error ?? 'The chat would not give a pass.');
  try {
    localStorage.setItem(STORE, JSON.stringify({ pass: body.pass, until: body.until }));
  } catch {}
  return body.pass;
}
