"use client";

import { useSyncExternalStore } from "react";

/**
 * المواضع التي حسمها المستخدم بنفسه — بالاستبدال أو بإبقاء النصّ.
 *
 * تُحفظ في المتصفح لكل مقطع: من راجع نصف المواضع ثم أغلق الصفحة يعود
 * إلى ما بقي، لا إلى القائمة كاملة. وهي حالة شخصية مؤقتة تزول بالاعتماد.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const cache = new Map<string, ReadonlySet<number>>();
const EMPTY: ReadonlySet<number> = new Set();

const key = (itemId: string) => `tafreegh:spots:${itemId}`;

function read(itemId: string): ReadonlySet<number> {
  const hit = cache.get(itemId);
  if (hit) return hit;
  let value: ReadonlySet<number> = EMPTY;
  try {
    const raw = localStorage.getItem(key(itemId));
    if (raw) value = new Set(JSON.parse(raw) as number[]);
  } catch {}
  cache.set(itemId, value);
  return value;
}

export function markSpot(itemId: string, id: number, done: boolean): void {
  const next = new Set(read(itemId));
  if (done) next.add(id);
  else next.delete(id);
  cache.set(itemId, next);
  try {
    localStorage.setItem(key(itemId), JSON.stringify([...next]));
  } catch {}
  listeners.forEach((l) => l());
}

export function clearSpots(itemId: string): void {
  cache.delete(itemId);
  try {
    localStorage.removeItem(key(itemId));
  } catch {}
  listeners.forEach((l) => l());
}

export function useResolvedSpots(itemId: string): ReadonlySet<number> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(itemId),
    () => EMPTY,
  );
}

/** طلب من المحرّر: اذهب إلى موضع، أو استبدله. */
export interface LocateRequest {
  para: number;
  text: string;
  offset: number;
  replacement?: string;
}

export const LOCATE_EVENT = "tafreegh:locate";

export function locate(request: LocateRequest): void {
  window.dispatchEvent(new CustomEvent<LocateRequest>(LOCATE_EVENT, { detail: request }));
}
