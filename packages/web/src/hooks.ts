import { useEffect, useRef } from "react";

/**
 * Calls `callback` every `intervalMs`. The latest callback closure is always
 * used, so it can read current state (e.g. to skip while an operation runs)
 * without resetting the timer.
 */
export function usePolling(callback: () => void, intervalMs: number): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    const id = setInterval(() => saved.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
