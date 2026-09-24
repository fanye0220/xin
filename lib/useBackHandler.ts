import { useEffect, useRef } from 'react';

type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function handleBackRequest(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    try {
      if (handlers[i]()) return true;
    } catch (err) {
      console.error('back handler failed', err);
    }
  }
  return false;
}

export function useBackHandler(enabled: boolean, handler: BackHandler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const wrapped = () => handlerRef.current();
    return pushBackHandler(wrapped);
  }, [enabled]);
}