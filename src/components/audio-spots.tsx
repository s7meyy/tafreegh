"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * الاستماع إلى موضع بعينه.
 *
 * مشغّل واحد للصفحة كلها، وكل زرّ «استمع» يقفز به إلى ثانية قبل
 * الموضع ويقف بعده بقليل. المستخدم يحسم الشك بأذنه لا بالتخمين —
 * وهذا ما لا تستطيعه المراجعة الآلية، فهي لم تسمع الصوت.
 */

const PAD_BEFORE_MS = 1_200;
const PAD_AFTER_MS = 900;

interface AudioApi {
  enabled: boolean;
  playing: string | null;
  play: (key: string, startMs: number, endMs: number) => void;
  stop: () => void;
  /** التشغيل الكامل: من موضع بعينه بلا نقطة توقف */
  playFrom: (ms: number) => void;
  /** الانتقال إلى موضع دون تغيير حال التشغيل */
  seek: (ms: number) => void;
  setRate: (rate: number) => void;
  /** عنصر الصوت نفسه — لمن يتابع الوقت الجاري إطارًا بإطار */
  element: () => HTMLAudioElement | null;
}

/** مفتاح التشغيل الكامل في `playing`، تمييزًا له عن تشغيل موضع */
export const FULL = "full";

const AudioContext = createContext<AudioApi>({
  enabled: false,
  playing: null,
  play: () => {},
  stop: () => {},
  playFrom: () => {},
  seek: () => {},
  setRate: () => {},
  element: () => null,
});

export function AudioProvider({
  itemId,
  enabled,
  children,
}: {
  itemId: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number>(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
  }, []);

  const play = useCallback((key: string, startMs: number, endMs: number) => {
    const el = audio.current;
    if (!el) return;
    stopAt.current = (endMs + PAD_AFTER_MS) / 1000;
    el.currentTime = Math.max(0, (startMs - PAD_BEFORE_MS) / 1000);
    setPlaying(key);
    el.play().catch(() => {
      setFailed(true);
      setPlaying(null);
    });
  }, []);

  const playFrom = useCallback((ms: number) => {
    const el = audio.current;
    if (!el) return;
    stopAt.current = Infinity;
    el.currentTime = Math.max(0, ms / 1000);
    setPlaying(FULL);
    el.play().catch(() => {
      setFailed(true);
      setPlaying(null);
    });
  }, []);

  const seek = useCallback((ms: number) => {
    const el = audio.current;
    if (el) el.currentTime = Math.max(0, ms / 1000);
  }, []);

  const setRate = useCallback((rate: number) => {
    if (audio.current) audio.current.playbackRate = rate;
  }, []);

  const element = useCallback(() => audio.current, []);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const tick = () => {
      if (el.currentTime >= stopAt.current) stop();
    };
    el.addEventListener("timeupdate", tick);
    el.addEventListener("ended", stop);
    return () => {
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("ended", stop);
    };
  }, [stop]);

  return (
    <AudioContext.Provider
      value={{ enabled: enabled && !failed, playing, play, stop, playFrom, seek, setRate, element }}
    >
      {enabled && <audio ref={audio} src={`/api/items/${itemId}/audio`} preload="none" />}
      {failed && (
        <p role="status" className="rounded-lg bg-brand-soft px-4 py-2 text-sm">
          تعذّر تشغيل الصوت — ربما حُذف أو لم يكتمل تحضيره.
        </p>
      )}
      {children}
    </AudioContext.Provider>
  );
}

export function useSpotAudio() {
  return useContext(AudioContext);
}

export function PlayButton({
  spot,
  startMs,
  endMs,
  label = "استمع",
}: {
  spot: string;
  startMs: number | null | undefined;
  endMs: number | null | undefined;
  label?: string;
}) {
  const { enabled, playing, play, stop } = useSpotAudio();
  if (!enabled || startMs == null) return null;
  const active = playing === spot;

  return (
    <button
      type="button"
      onClick={() => (active ? stop() : play(spot, startMs, endMs ?? startMs + 1_000))}
      aria-pressed={active}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-line px-3 text-sm hover:border-brand"
    >
      <span aria-hidden>{active ? "■" : "▶"}</span>
      <span>{active ? "إيقاف" : label}</span>
    </button>
  );
}
