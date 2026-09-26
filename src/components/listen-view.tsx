"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clock } from "@/lib/format";
import { listenLayout, wordAt } from "@/lib/transcript/listen";
import type { Word } from "@/lib/transcript/types";
import { FULL, useSpotAudio } from "./audio-spots";

const RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const JUMP_MS = 5_000;

/**
 * وضع الاستماع: الصوت والنصّ معًا، والكلمة الجارية مضاءة.
 *
 * المراجعة الأمتن للتفريغ أن يُسمع وهو يُقرأ: الأذن تلتقط ما فات
 * العين، والإضاءة تُبقي القارئ في موضعه. النقر على كلمة يشغّل منها،
 * و«حرّر هنا» ينقل إلى المحرّر عند الكلمة الجارية.
 *
 * الإضاءة تُحدَّث في DOM مباشرة كل إطار، لا في حالة React: إعادة رسم
 * آلاف الكلمات ستين مرة في الثانية تُثقل الصفحة بلا داعٍ.
 */
export function ListenView({
  text,
  timed,
  onEditAt,
}: {
  text: string;
  timed: readonly Word[];
  onEditAt: (start: number, end: number) => void;
}) {
  const { playing, playFrom, stop, seek, setRate, element } = useSpotAudio();
  const layout = useMemo(() => listenLayout(text, timed), [text, timed]);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);
  const current = useRef(-1);
  const follow = useRef(true);
  const [now, setNow] = useState(0);
  const [rate, setRateState] = useState(1);
  const active = playing === FULL;

  const paint = useCallback(
    (index: number) => {
      const previous = current.current;
      if (index === previous) return;
      current.current = index;

      // ما قبل الجارية باهت، والجارية مضاءة. التحديث للمدى المتغيّر وحده.
      const [lo, hi] = previous < index ? [previous, index] : [index, previous];
      for (let i = Math.max(0, lo); i <= hi; i++) {
        const el = spans.current[i];
        if (!el) continue;
        el.toggleAttribute("data-past", i < index);
        el.toggleAttribute("data-current", i === index);
      }

      const el = spans.current[index];
      if (el && follow.current) {
        const box = el.getBoundingClientRect();
        if (box.top < 80 || box.bottom > window.innerHeight - 120) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    },
    [],
  );

  // حلقة الإطارات ما دام الصوت يعمل؛ وعند التوقف أو القفز تحديثٌ واحد.
  useEffect(() => {
    const audio = element();
    if (!audio) return;
    let frame = 0;
    let lastSecond = -1;

    const update = () => {
      const ms = audio.currentTime * 1000;
      paint(wordAt(layout.words, ms));
      const second = Math.floor(audio.currentTime);
      if (second !== lastSecond) {
        lastSecond = second;
        setNow(ms);
      }
    };
    const loop = () => {
      update();
      if (!audio.paused) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };

    audio.addEventListener("play", start);
    audio.addEventListener("seeked", update);
    update();
    if (!audio.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("play", start);
      audio.removeEventListener("seeked", update);
    };
  }, [element, layout, paint]);

  // تتبّع التمرير يتوقف إن مرّر المستخدم بيده، ويعود مع التشغيل التالي.
  useEffect(() => {
    const pause = () => (follow.current = false);
    window.addEventListener("wheel", pause, { passive: true });
    window.addEventListener("touchmove", pause, { passive: true });
    return () => {
      window.removeEventListener("wheel", pause);
      window.removeEventListener("touchmove", pause);
    };
  }, []);

  const toggle = () => {
    if (active) return stop();
    follow.current = true;
    const audio = element();
    playFrom(audio ? audio.currentTime * 1000 : 0);
  };

  const jump = (delta: number) => {
    const audio = element();
    if (audio) seek(audio.currentTime * 1000 + delta);
  };

  const pick = (event: React.MouseEvent) => {
    const index = Number((event.target as HTMLElement).dataset.i);
    if (Number.isNaN(index)) return;
    follow.current = true;
    // من بداية الكلمة بالضبط: البدء قبلها يضيء سابقتها أولًا فيُربك
    playFrom(layout.words[index]!.startMs);
  };

  const editHere = () => {
    const word = layout.words[Math.max(0, current.current)];
    if (!word) return;
    stop();
    onEditAt(word.start, word.end);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === " " || event.key === "k") {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowLeft") {
      // في واجهة من اليمين إلى اليسار، اليسار هو «التالي»
      event.preventDefault();
      jump(JUMP_MS);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      jump(-JUMP_MS);
    }
  };

  const duration = layout.words.at(-1)?.endMs ?? 0;

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={active}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 font-medium text-white"
        >
          <span aria-hidden>{active ? "❚❚" : "▶"}</span>
          {active ? "إيقاف مؤقت" : "تشغيل"}
        </button>
        <button
          type="button"
          onClick={() => jump(-JUMP_MS)}
          aria-label="رجوع خمس ثوانٍ"
          className="min-h-11 min-w-11 rounded-lg border border-line px-3 hover:border-brand"
        >
          −5ث
        </button>
        <button
          type="button"
          onClick={() => jump(JUMP_MS)}
          aria-label="تقدّم خمس ثوانٍ"
          className="min-h-11 min-w-11 rounded-lg border border-line px-3 hover:border-brand"
        >
          +5ث
        </button>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
          السرعة
          <select
            value={rate}
            onChange={(e) => {
              const r = Number(e.target.value);
              setRateState(r);
              setRate(r);
            }}
            className="min-h-11 rounded-lg border border-line bg-panel px-2 text-ink"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                ×{r}
              </option>
            ))}
          </select>
        </label>
        <span className="ltr-inline text-sm text-ink-soft" aria-live="off">
          {clock(now)} / {clock(duration)}
        </span>
        <button
          type="button"
          onClick={editHere}
          className="ms-auto min-h-11 rounded-lg border border-line px-4 hover:border-brand"
        >
          حرّر عند هذه الكلمة
        </button>
      </div>

      <p className="text-sm text-ink-soft">
        انقر أي كلمة للتشغيل منها. المسافة للتشغيل والإيقاف، والسهمان للقفز خمس ثوانٍ.
      </p>

      {/* النقر مفوَّض إلى الحاوية: آلاف الكلمات بلا آلاف المستمعين */}
      <div
        role="region"
        aria-label="النصّ متزامنًا مع الصوت"
        tabIndex={0}
        onKeyDown={onKey}
        onClick={pick}
        className="space-y-5 rounded-xl border border-line bg-panel p-5 leading-loose"
      >
        {layout.paragraphs.map((p, pi) => (
          <p key={pi}>
            {p.speaker && <strong className="me-1 font-semibold">{p.speaker}:</strong>}
            {layout.words.slice(p.from, p.to).map((w, k) => {
              const i = p.from + k;
              return (
                <span key={i}>
                  <span
                    ref={(el) => {
                      spans.current[i] = el;
                    }}
                    data-i={i}
                    className="listen-word"
                  >
                    {w.text}
                  </span>{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}
