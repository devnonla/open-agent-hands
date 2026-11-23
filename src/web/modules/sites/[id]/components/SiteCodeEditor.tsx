import { Button, Card, Icon, type IconName, Spin, Tabs, Tag, message } from "devnonla-ui";
import { AnimatePresence, motion } from "framer-motion";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Site, SiteSourceFile } from "src/common/types";
import type { Monaco } from "src/components/MonacoEditor";
import { MonacoEditor } from "src/components/MonacoEditor";
import { sitesApi } from "../../common/sitesApi";

const EDITOR_FILES = ["app.tsx", "styles.css", "backend.ts"] as const satisfies readonly SiteSourceFile[];
type EditorFile = (typeof EDITOR_FILES)[number];

const FILE_META: Record<EditorFile, { language: string; icon: IconName }> = {
  "app.tsx": { language: "typescript", icon: "document" },
  "styles.css": { language: "css", icon: "pen" },
  "backend.ts": { language: "typescript", icon: "code" },
};

export type SiteCodeEditorHandle = {
  flush: (opts?: { quiet?: boolean }) => Promise<void>;
};

interface SiteCodeEditorProps {
  siteId: string;
  reloadToken?: number;
  onSiteUpdated: (site: Site) => void;
}

function syncInactiveSiteModels(monacoInstance: Monaco, files: Record<SiteSourceFile, string>, active: EditorFile) {
  for (const file of EDITOR_FILES) {
    const uri = monacoInstance.Uri.parse(`file:///${file}`);
    const existing = monacoInstance.editor.getModel(uri);
    if (!existing) {
      monacoInstance.editor.createModel(files[file], FILE_META[file].language, uri);
      continue;
    }
    if (file === active) continue;
    if (existing.getValue() !== files[file]) existing.setValue(files[file]);
  }
}

export const SiteCodeEditor = forwardRef<SiteCodeEditorHandle, SiteCodeEditorProps>(function SiteCodeEditor({ siteId, reloadToken = 0, onSiteUpdated }, ref) {
  const [selected, setSelected] = useState<EditorFile>("app.tsx");
  const [drafts, setDrafts] = useState<Record<SiteSourceFile, string> | null>(null);
  const [saved, setSaved] = useState<Record<SiteSourceFile, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadedOnceRef = useRef(false);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const monacoRef = useRef<Monaco | null>(null);

  const loadFiles = useCallback(async () => {
    const res = await sitesApi.getFiles(siteId);
    const current = draftsRef.current;
    const prevSaved = savedRef.current;
    const nextSaved = res.files;
    const nextDrafts = { ...nextSaved };
    if (current && prevSaved) {
      for (const file of EDITOR_FILES) {
        if (current[file] !== prevSaved[file]) nextDrafts[file] = current[file];
      }
    }
    setSaved(nextSaved);
    setDrafts(nextDrafts);
  }, [siteId]);

  useEffect(() => {
    let cancelled = false;
    if (!loadedOnceRef.current) setLoading(true);
    void loadFiles()
      .catch((err: unknown) => {
        if (!cancelled) message.error(err instanceof Error ? err.message : "Failed to load files");
      })
      .finally(() => {
        if (cancelled) return;
        loadedOnceRef.current = true;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadFiles, reloadToken]);

  const dirtyFiles = useMemo(() => {
    const set = new Set<EditorFile>();
    if (!drafts || !saved) return set;
    for (const file of EDITOR_FILES) {
      if (drafts[file] !== saved[file]) set.add(file);
    }
    return set;
  }, [drafts, saved]);

  const saveFiles = useCallback(
    async (files: SiteSourceFile[], opts?: { quiet?: boolean }) => {
      const current = draftsRef.current;
      const prevSaved = savedRef.current;
      if (!current || !prevSaved) return;
      const dirty = files.filter((file) => current[file] !== prevSaved[file]);
      if (dirty.length === 0) return;
      setSaving(true);
      try {
        let lastSite: Site | undefined;
        let depsInstalled = false;
        for (const file of dirty) {
          const res = await sitesApi.putFile(siteId, file, current[file]);
          lastSite = res.site;
          depsInstalled = depsInstalled || Boolean(res.depsInstalled);
          setSaved((s) => (s ? { ...s, [file]: current[file] } : s));
        }
        if (depsInstalled) await loadFiles();
        if (lastSite) onSiteUpdated(lastSite);
        if (!opts?.quiet) message.success(depsInstalled ? "Saved — dependencies installed" : "Saved");
      } catch (err: unknown) {
        if (!opts?.quiet) message.error(err instanceof Error ? err.message : "Save failed");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [siteId, onSiteUpdated, loadFiles],
  );

  const handleSave = useCallback(() => {
    void saveFiles([...EDITOR_FILES]).catch(() => undefined);
  }, [saveFiles]);

  useImperativeHandle(
    ref,
    () => ({
      flush: async (opts) => {
        await saveFiles([...EDITOR_FILES], opts);
      },
    }),
    [saveFiles],
  );

  useEffect(() => {
    const monacoInstance = monacoRef.current;
    if (!monacoInstance || !drafts) return;
    syncInactiveSiteModels(monacoInstance, drafts, selected);
  }, [drafts, selected]);

  const handleEditorMount = useCallback((_editor: unknown, monacoInstance: Monaco) => {
    monacoRef.current = monacoInstance;
    const files = draftsRef.current;
    if (files) syncInactiveSiteModels(monacoInstance, files, selectedRef.current);
  }, []);

  const isDirty = dirtyFiles.size > 0;
  const meta = FILE_META[selected];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <Tabs
        className="shrink-0 bg-muted/30 px-3"
        aria-label="Site files"
        activeKey={selected}
        onChange={(key) => setSelected(key as EditorFile)}
        items={EDITOR_FILES.map((file) => ({
          key: file,
          icon: FILE_META[file].icon,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium">{file}</span>
              {dirtyFiles.has(file) ? <span className="size-1.5 shrink-0 rounded-full bg-brand-700" /> : null}
            </span>
          ),
        }))}
      />

      <div className="monaco-scroll-pad-x relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {loading || !drafts ? (
          <div className="flex h-full items-center justify-center">
            <Spin tip="Loading files…" />
          </div>
        ) : (
          <MonacoEditor path={`file:///${selected}`} language={meta.language} value={drafts[selected]} keepCurrentModel onChange={(v) => setDrafts((d) => (d ? { ...d, [selected]: v ?? "" } : d))} onSave={handleSave} onMount={handleEditorMount} height="100%" options={{ fontSize: 13, tabSize: 2 }} />
        )}

        <AnimatePresence>
          {isDirty ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
              {isDirty ? (
                <Card>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Tag color="brand">Unsaved</Tag>
                    <Button size="small" type="primary" icon={!saving ? <Icon name="document" size={14} /> : undefined} loading={saving} onClick={handleSave}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </Card>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
});
