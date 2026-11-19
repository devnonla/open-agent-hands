import { message } from "devnonla-ui";

export async function copyText(text: string, label = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    message.success(label);
    return true;
  } catch {
    message.error("Copy failed");
    return false;
  }
}
