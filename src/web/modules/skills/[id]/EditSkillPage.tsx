import { Alert, Button, Icon, Modal, Splitter, message } from "devnonla-ui";
import { MarkdownEditor } from "devnonla-ui/markdown";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import type { Skill, SkillReference } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { markdownFenceComponents } from "src/components/markdown/fenceBlocks";
import { useAppDispatch } from "src/store/store";
import { isBuiltinSkillId } from "../common/builtinSkills";
import { skillsApi } from "../common/skillsApi";
import { deleteSkill, updateSkill, upsertSkillLocal } from "../common/skillsSlice";
import { EditSkillHeader } from "./components/EditSkillHeader";
import { type SkillEditorFile, type SkillFileMark, SkillFileTree } from "./components/SkillFileTree";
import { SkillSettingsDialog } from "./components/SkillSettingsDialog";

function EditSkillSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-55 shrink-0 border-r border-border bg-card p-3">
          <div className="mb-3 h-3 w-16 animate-pulse rounded bg-muted" />
          <div className="mb-2 h-7 w-full animate-pulse rounded-md bg-muted" />
          <div className="mb-2 h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="mb-1.5 h-6 w-full animate-pulse rounded-md bg-muted/70" />
          <div className="h-6 w-4/5 animate-pulse rounded-md bg-muted/70" />
        </div>
        <div className="min-w-0 flex-1 border-r border-border">
          <div className="h-10 border-b border-border bg-card/80 px-3 py-3">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-2 p-4">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/60" />
          </div>
        </div>
        <div className="w-100 shrink-0 bg-card p-3">
          <div className="mb-4 h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="mx-auto mt-16 h-3 w-48 animate-pulse rounded bg-muted/60" />
          <div className="mx-auto mt-3 h-8 w-52 animate-pulse rounded-lg bg-muted/50" />
          <div className="mx-auto mt-2 h-8 w-52 animate-pulse rounded-lg bg-muted/50" />
        </div>
      </div>
    </div>
  );
}

export default function EditSkillPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const [skill, setSkill] = useState<Skill | null>(null);
  const [refs, setRefs] = useState<SkillReference[]>([]);
  const [selected, setSelected] = useState<SkillEditorFile>({ kind: "skill", path: "SKILL.md" });
  const [skillDraft, setSkillDraft] = useState("");
  const [savedSkill, setSavedSkill] = useState("");
  const [refDrafts, setRefDrafts] = useState<Record<string, string>>({});
  const [savedRefs, setSavedRefs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const skillDraftRef = useRef(skillDraft);
  skillDraftRef.current = skillDraft;
  const refDraftsRef = useRef(refDrafts);
  refDraftsRef.current = refDrafts;
  const savedSkillRef = useRef(savedSkill);
  savedSkillRef.current = savedSkill;
  const savedRefsRef = useRef(savedRefs);
  savedRefsRef.current = savedRefs;

  const applyServerState = useCallback(
    (s: Skill, references: SkillReference[], hintPath?: string) => {
      dispatch(upsertSkillLocal(s));
      setSkill(s);
      const md = s.content;
      const localWasClean = skillDraftRef.current === savedSkillRef.current;
      setSavedSkill(md);
      if (localWasClean) setSkillDraft(md);

      const ids = new Set(references.map((r) => r.id));
      setRefs(references);
      const previousSaved = savedRefsRef.current;
      const nextSaved: Record<string, string> = {};
      for (const r of references) nextSaved[r.id] = r.content;
      savedRefsRef.current = nextSaved;
      setSavedRefs(nextSaved);
      setRefDrafts((prevLocal) => {
        const nextLocal: Record<string, string> = {};
        for (const r of references) {
          const local = prevLocal[r.id];
          const wasClean = local === undefined || local === (previousSaved[r.id] ?? "");
          nextLocal[r.id] = wasClean ? r.content : local!;
        }
        return nextLocal;
      });

      if (selectedRef.current.kind === "reference" && !ids.has(selectedRef.current.refId)) {
        setSelected({ kind: "skill", path: "SKILL.md" });
      } else if (hintPath === "SKILL.md") {
        setSelected({ kind: "skill", path: "SKILL.md" });
      } else if (hintPath) {
        const ref = references.find((r) => `references/${r.name}.md` === hintPath);
        if (ref) {
          setSelected({ kind: "reference", path: hintPath, refId: ref.id, name: ref.name });
        }
      }
    },
    [dispatch],
  );

  const load = useCallback(async () => {
    if (!id) return;
    const [s, references] = await Promise.all([skillsApi.get(id), skillsApi.listReferences(id)]);
    applyServerState(s, references);
  }, [id, applyServerState]);

  useEffect(() => {
    load().catch(() => setError("Failed to load skill"));
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const unsub = wsClient.on<Skill>("skills:updated", (payload) => {
      if (payload.id !== id) return;
      void skillsApi.listReferences(id).then((list) => applyServerState(payload, list));
    });
    return unsub;
  }, [id, applyServerState]);

  const dirtyPaths = useMemo(() => {
    const set = new Set<string>();
    if (skillDraft !== savedSkill) set.add("SKILL.md");
    for (const r of refs) {
      if ((refDrafts[r.id] ?? "") !== (savedRefs[r.id] ?? "")) {
        set.add(`references/${r.name}.md`);
      }
    }
    return set;
  }, [skillDraft, savedSkill, refs, refDrafts, savedRefs]);

  const fileMarks = useMemo(() => {
    const marks: Record<string, SkillFileMark> = {};
    for (const path of dirtyPaths) marks[path] = "modified";
    return marks;
  }, [dirtyPaths]);

  const isDirty = dirtyPaths.size > 0;

  const editorValue = selected.kind === "skill" ? skillDraft : (refDrafts[selected.refId] ?? "");

  const handleEditorChange = (value: string) => {
    if (selected.kind === "skill") {
      setSkillDraft(value);
    } else {
      setRefDrafts((prev) => ({ ...prev, [selected.refId]: value }));
    }
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void handleSave();
    }
  };

  const handleSave = async (opts?: { quiet?: boolean }): Promise<boolean> => {
    if (!id || !skill) return true;
    setSaving(true);
    setError("");
    try {
      if (skillDraft !== savedSkill) {
        const updated = (await dispatch(updateSkill({ id, content: skillDraft })).unwrap()) as Skill;
        setSkill(updated);
        setSkillDraft(updated.content);
        setSavedSkill(updated.content);
      }
      for (const r of refs) {
        const draft = refDrafts[r.id] ?? "";
        if (draft !== (savedRefs[r.id] ?? "")) {
          await skillsApi.updateReference(id, r.id, { content: draft });
        }
      }
      const references = await skillsApi.listReferences(id);
      setRefs(references);
      const map: Record<string, string> = {};
      for (const r of references) map[r.id] = r.content;
      setRefDrafts(map);
      setSavedRefs({ ...map });
      if (!opts?.quiet) message.success("Saved");
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      if (!opts?.quiet) message.error(msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSettingsSaved = (updated: Skill) => {
    dispatch(upsertSkillLocal(updated));
    setSkill(updated);
    setSavedSkill(updated.content);
    if (skillDraft === savedSkill) setSkillDraft(updated.content);
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await dispatch(deleteSkill(id)).unwrap();
      message.success("Deleted");
      navigate("/skills");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateReference = useCallback(
    async (body: { name: string; title: string }) => {
      if (!id) return;
      const created = await skillsApi.createReference(id, body);
      setRefs((prev) => [...prev, created]);
      setRefDrafts((d) => ({ ...d, [created.id]: created.content }));
      setSavedRefs((d) => ({ ...d, [created.id]: created.content }));
      setSelected({
        kind: "reference",
        path: `references/${created.name}.md`,
        refId: created.id,
        name: created.name,
      });
    },
    [id],
  );

  const handleDeleteReference = useCallback(
    async (refId: string) => {
      if (!id) return;
      await skillsApi.deleteReference(id, refId);
      setRefs((prev) => prev.filter((r) => r.id !== refId));
      setRefDrafts((d) => {
        const next = { ...d };
        delete next[refId];
        return next;
      });
      setSavedRefs((d) => {
        const next = { ...d };
        delete next[refId];
        return next;
      });
      if (selectedRef.current.kind === "reference" && selectedRef.current.refId === refId) {
        setSelected({ kind: "skill", path: "SKILL.md" });
      }
    },
    [id],
  );

  const confirmDeleteReference = () => {
    if (selected.kind !== "reference") return;
    Modal.confirm({
      title: `Delete "${selected.name}.md"?`,
      content: "This action cannot be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        await handleDeleteReference(selected.refId);
        message.success("Reference deleted");
      },
    });
  };

  const headerTitle = skill?.name || "Skill";

  if (!id) return null;

  if (!skill) {
    return <EditSkillSkeleton />;
  }

  const builtin = isBuiltinSkillId(id);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <EditSkillHeader title={headerTitle} onOpenSettings={builtin ? undefined : () => setSettingsOpen(true)} />

        <RenderIf condition={!!error}>
          <Alert type="error" description={error} showIcon closable={{ onClose: () => setError("") }} className="m-3" />
        </RenderIf>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <Splitter className="min-h-0 min-w-0 flex-1">
            <Splitter.Panel defaultSize={220} min={160} max={420} className="min-h-0 overflow-hidden">
              <SkillFileTree references={refs} selected={selected} fileMarks={fileMarks} onSelect={setSelected} onCreateReference={handleCreateReference} readOnly={builtin} />
            </Splitter.Panel>
            <Splitter.Panel min={280} className="min-h-0 overflow-hidden">
              <main className="relative flex h-full min-h-0 min-w-0 flex-col">
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" onKeyDown={onEditorKeyDown}>
                  <MarkdownEditor
                    key={selected.path}
                    className="min-h-0 flex-1 rounded-none border-0"
                    showModes={false}
                    title={
                      <span className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{selected.path}</span>
                        {selected.kind === "reference" && !builtin ? (
                          <button type="button" onClick={confirmDeleteReference} className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive" title="Delete reference" aria-label={`Delete ${selected.name}.md`}>
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </span>
                    }
                    value={editorValue}
                    readOnly={builtin}
                    onChange={builtin ? undefined : handleEditorChange}
                    components={markdownFenceComponents}
                  />

                  <AnimatePresence>
                    {!builtin && isDirty ? (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
                        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
                          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand-700" />
                          <span className="mr-1 text-xs font-medium tracking-wide text-brand-700">Unsaved</span>
                          <Button size="small" type="primary" icon={!saving ? <Icon name="document" size={14} /> : undefined} loading={saving} onClick={() => void handleSave()}>
                            {saving ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </main>
            </Splitter.Panel>
          </Splitter>
        </div>
      </div>

      {settingsOpen && !builtin ? <SkillSettingsDialog skill={skill} onClose={() => setSettingsOpen(false)} onSaved={handleSettingsSaved} onDelete={handleDelete} /> : null}
    </div>
  );
}
