"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Section tabs under the persistent header. The active tab lives in the URL hash,
 * so a reload (or a refresh after ending a workout) lands where you were.
 */
export default function Tabs({ tabs }: { tabs: Array<{ id: string; label: string; content: ReactNode }> }) {
  const [active, setActive] = useState(tabs[0].id);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  function select(id: string) {
    setActive(id);
    history.replaceState(null, "", id === tabs[0].id ? window.location.pathname : `#${id}`);
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            className="tab"
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </>
  );
}
