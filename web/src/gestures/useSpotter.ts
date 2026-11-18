import { useEffect, useRef } from 'react';
import type { Session } from '../app/session';
import type { LoadedModel } from '../ml/model-client';
import { library } from './library';
import { GestureSpotter, type SpotEvent } from './spotter';

/**
 * Runs the continuous spotter on the session's camera frames while mounted.
 * The session's own one-sign-at-a-time recogniser stays off meanwhile.
 */
export function useSpotter(
  session: Session,
  model: LoadedModel,
  onEvent: (event: SpotEvent) => void,
): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    const spotter = new GestureSpotter(model.meta, {
      infer: (input) => model.client.infer(input),
      index: () => library.spotIndex(),
      matchBurst: (embedding) => library.match(embedding),
      emit: (event) => {
        handler.current(event);
      },
    });
    const off = session.onFrame((frame, source, info) => {
      if (source === 'off') return;
      spotter.push(frame, info.t);
    });
    return () => {
      off();
      spotter.stop();
    };
  }, [session, model]);
}
