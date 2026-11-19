import { Button, Icon, message } from "devnonla-ui";
import { MarkdownEditor } from "devnonla-ui/markdown";
import { AnimatePresence, motion } from "framer-motion";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { markdownFenceComponents } from "src/components/markdown/fenceBlocks";
import { useToolMentions } from "src/components/markdown/toolMentions";
import { updateAgent } from "src/modules/agents/common/agentsSlice";
import { useAppDispatch } from "src/store/store";
import { useAgentDetailContext } from "../common/agentDetailContext";

const PLACEHOLDER = "Write the system prompt for this agent…";

export function PromptPage() {
  const { id, systemPrompt, setSystemPrompt, agent, readonly } = useAgentDetailContext();

  const dispatch = useAppDispatch();

  const published = agent.systemPrompt ?? "";

  const [savedPrompt, setSavedPrompt] = useState(published);
  const [saving, setSaving] = useState(false);
  const dirty = systemPrompt !== savedPrompt;
  const promptRef = useRef(systemPrompt);
  promptRef.current = systemPrompt;
  const savedPromptRef = useRef(savedPrompt);
  savedPromptRef.current = savedPrompt;
  const savingRef = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  useToolMentions(previewRef);

  const lastPublishedRef = useRef(published);
  useEffect(() => {
    if (published === lastPublishedRef.current) return;
    lastPublishedRef.current = published;
    const localWasClean = promptRef.current === savedPromptRef.current;
    savedPromptRef.current = published;
    setSavedPrompt(published);
    if (localWasClean) setSystemPrompt(published);
  }, [published, setSystemPrompt]);

  const savePrompt = useCallback(
    async (opts?: { quiet?: boolean }): Promise<boolean> => {
      const next = promptRef.current;
      if (next === savedPromptRef.current) return true;
      if (savingRef.current) return false;
      savingRef.current = true;
      setSaving(true);
      try {
        await dispatch(updateAgent({ id, systemPrompt: next || null })).unwrap();
        lastPublishedRef.current = next;
        savedPromptRef.current = next;
        setSavedPrompt(next);
        if (!opts?.quiet) message.success("Saved");
        return true;
      } catch {
        if (!opts?.quiet) message.error("Failed to save prompt");
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [dispatch, id],
  );

  const handleChange = useCallback(
    (value: string) => {
      setSystemPrompt(value);
    },
    [setSystemPrompt],
  );

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void savePrompt();
    }
  };

  if (!id) return null;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      <div ref={previewRef} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden" onKeyDown={onEditorKeyDown}>
        <MarkdownEditor className="nonla-instruct-editor min-h-0 flex-1 rounded-none border-0" placeholder={PLACEHOLDER} value={systemPrompt} mode="preview" readOnly={readonly} onChange={readonly ? undefined : handleChange} components={markdownFenceComponents} />

        <AnimatePresence>
          {readonly || !dirty ? null : (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
              <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-700" />
                <span className="mr-1 text-xs font-medium tracking-wide text-brand-700">Unsaved</span>
                <Button size="small" type="primary" icon={!saving ? <Icon name="document" size={14} /> : undefined} loading={saving} onClick={() => void savePrompt()}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
