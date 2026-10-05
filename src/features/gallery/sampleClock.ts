import { useEffect, useRef, useState } from 'react';

type Tick = (now: number) => void;

const subscribers = new Set<Tick>();
let handle = 0;

const pump = (now: number) => {
  for (const fn of subscribers) fn(now);
  handle = subscribers.size > 0 ? requestAnimationFrame(pump) : 0;
};

const subscribe = (fn: Tick) => {
  subscribers.add(fn);
  if (handle === 0) handle = requestAnimationFrame(pump);
};

const unsubscribe = (fn: Tick) => {
  subscribers.delete(fn);
  if (subscribers.size === 0 && handle !== 0) {
    cancelAnimationFrame(handle);
    handle = 0;
  }
};

/**
 * Drives a one-shot animation cycle for a preview card.
 *
 * Every card shares a single requestAnimationFrame loop, and a card only joins
 * it while it is actually mid-cycle — so a gallery of thirty cards sitting idle
 * costs nothing. Bump `token` (on hover, on select, on scrolling into view) to
 * replay.
 */
export const useSampleClock = (token: number, duration: number, loop = false): number => {
  const [time, setTime] = useState(duration);
  const finished = useRef(false);

  useEffect(() => {
    if (token === 0) {
      setTime(duration);
      return;
    }

    const started = performance.now();
    finished.current = false;

    const tick: Tick = (now) => {
      if (finished.current) return;
      const totalElapsed = (now - started) / 1000;
      if (loop) {
        const elapsed = totalElapsed % duration;
        setTime(elapsed);
        return;
      }
      if (totalElapsed >= duration) {
        finished.current = true;
        setTime(duration);
        unsubscribe(tick);
        return;
      }
      setTime(totalElapsed);
    };

    subscribe(tick);
    return () => {
      finished.current = true;
      unsubscribe(tick);
    };
  }, [token, duration, loop]);

  return time;
};

/**
 * True once the element has been scrolled into view. Cards use this to avoid
 * mounting work — and to fire their first animation — only when seen.
 */
export const useInView = <T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  rootMargin = '120px',
): boolean => {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // no IntersectionObserver (very old browser, jsdom): treat as visible
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
};
