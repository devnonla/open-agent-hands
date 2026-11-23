import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FeatureIcon } from "src/components/FeatureIcon";
import { prepareToolIcon, validateToolIcon } from "../common/tool-icon";

export function ToolIcon({ icon, size }: { icon?: string | null; size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const idPrefix = `ti${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useMemo(() => validateToolIcon(icon), [icon]);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const host = ref.current;
    setFailed(false);
    if (!host || !svg) return;
    try {
      const node = prepareToolIcon(svg, idPrefix);
      host.replaceChildren(node);
      const box = node.getBBox();
      if (!box.width && !box.height) setFailed(true);
    } catch {
      setFailed(true);
    }
    return () => host.replaceChildren();
  }, [svg, idPrefix]);

  if (!svg || failed) return <FeatureIcon name="tools" size={size} />;
  return <span ref={ref} className="flex shrink-0 overflow-hidden text-muted-foreground" style={{ width: size, height: size }} />;
}
