import { useCallback, useEffect, useRef, useState } from "react";
import { getPref, setPref } from "./storage";

/** Avisa os outros componentes que usam a mesma chave quando ela muda. */
const listeners = new Set<(key: string) => void>();

/** Preferência salva no armazenamento local, sincronizada entre os componentes que usam a mesma chave. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const fb = useRef(fallback);
  const [value, setValue] = useState<T>(() => getPref(key, fallback));

  useEffect(() => {
    setValue(getPref(key, fb.current));
    const on = (k: string) => {
      if (k === key) setValue(getPref(key, fb.current));
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, [key]);

  const set = useCallback(
    (v: T) => {
      setPref(key, v);
      setValue(v);
      listeners.forEach((l) => l(key));
    },
    [key],
  );

  return [value, set];
}
