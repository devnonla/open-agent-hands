import { useEffect, useState } from "react";

function readDark(el: Element | null): boolean {
  if (!el) return true;
  if (el.classList.contains("light")) return false;
  return true;
}

/** Dark and light sit on `.nonla-ui` (devnonla-ui 0.17). */
export function useNonlaDark(): boolean {
  const [dark, setDark] = useState(() => (typeof document === "undefined" ? true : readDark(document.querySelector(".nonla-ui"))));

  useEffect(() => {
    const host = document.querySelector(".nonla-ui");
    if (!host) return;
    const sync = () => setDark(readDark(host));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
