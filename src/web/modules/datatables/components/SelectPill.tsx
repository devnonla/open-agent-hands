import { Tag } from "devnonla-ui";

const SELECT_PILLS = ["#cd6338", "#466edf", "#319075", "#b27e34", "#ca5d43", "#874fe0"] as const;

function hashHue(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h % SELECT_PILLS.length;
}

export function SelectPill({ value, className }: { value: string; className?: string }) {
  return (
    <Tag color={SELECT_PILLS[hashHue(value)]} variant="solid" className={className}>
      {value}
    </Tag>
  );
}
