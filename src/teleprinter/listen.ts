import { Link } from '../chat/link';
import type { CLOSED, Turn } from '../chat/protocol';
import { split } from '../typewriter/layouts';
import type { Wire } from './telegram';

export type ListenState = 'connecting' | 'open' | 'closed' | keyof typeof CLOSED;

/**
 * The teleprinter on a chat room's line: it comes in as a person of its own (it never holds the
 * line) and prints each turn once it's over, as a telegram from whoever typed it, in their
 * ink. `url` is the room's WebSocket address, pass and all.
 */
export function listen(url: string, wire: Wire, onState: (s: ListenState) => void) {
  const link = new Link(url, () => ({ t: 'hello', name: 'Teleprinter' }));
  let current: Turn | null = null;
  link.onState = (s) => onState(link.ended ?? s);
  link.onMessage = (m) => {
    switch (m.t) {
      case 'welcome':
        current = m.current && { ...m.current };
        break;
      case 'turn':
        current = { ...m.turn };
        break;
      case 'type':
        if (current?.id === m.id) current.text += m.s;
        break;
      case 'back':
        if (current?.id === m.id) current.text = split(current.text).slice(0, -1).join('');
        break;
      case 'end': {
        const turn = current;
        current = null;
        if (turn?.id === m.id && turn.text.trim())
          void wire.send({ text: turn.text, from: turn.name, ink: turn.ink, at: new Date(turn.at) });
        break;
      }
    }
  };
  return { close: () => link.close() };
}
