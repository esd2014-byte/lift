"use client";

import { useState } from "react";
import { LINES, lineIndex } from "@/lib/motivation";

export default function Motivation({ date }: { date: string }) {
  const [i, setI] = useState(() => lineIndex(date));
  return (
    <h1 className="hype">
      <button type="button" onClick={() => setI((i + 1) % LINES.length)} aria-label={`${LINES[i]} (tap for another)`}>
        {LINES[i]}
      </button>
    </h1>
  );
}
