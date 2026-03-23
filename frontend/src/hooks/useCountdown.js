import { useState, useEffect, useRef } from "react";

export const useCountdown = (timerEndAt) => {
  const [remaining, setRemaining] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!timerEndAt) {
      setRemaining(null);
      return;
    }

    const endMs = new Date(timerEndAt).getTime();

    const tick = () => {
      const diff = Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
      setRemaining(diff);
      if (diff <= 0 && intervalRef.current) clearInterval(intervalRef.current);
    };

    tick();
    intervalRef.current = setInterval(tick, 250);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerEndAt]);

  return remaining;
};
