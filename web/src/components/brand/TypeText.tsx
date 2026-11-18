import { useEffect, useState } from 'react';
import { motionReduced } from './motion';

/** Types its text out whenever it changes, followed by a blinking block caret. */
export function TypeText({ text, speed = 55 }: { text: string; speed?: number }) {
  const [typed, setTyped] = useState({ text, n: 0 });
  const still = motionReduced();
  const n = still ? text.length : typed.text === text ? typed.n : 0;
  useEffect(() => {
    if (still || n >= text.length) return;
    const id = window.setTimeout(() => {
      setTyped({ text, n: n + 1 });
    }, speed);
    return () => {
      window.clearTimeout(id);
    };
  }, [text, n, speed, still]);
  return (
    <span className="type-text">
      {text.slice(0, n)}
      <i className="type-caret" aria-hidden />
    </span>
  );
}
