import { Button, Popconfirm, Icon } from "devnonla-ui";

export interface DraftReviewConfirm {
  title: string;
  description: string;
}

export interface DraftReviewBarProps {
  onApprove: () => void;
  onDiscard: () => void;
  approving?: boolean;
  discarding?: boolean;
  /** Files with unpublished changes. Omit for single-file editors. Empty list hides the bar. */
  changedFiles?: string[];
  currentFile?: string;
  onReviewNext?: () => void;
  /** When set, Approve is wrapped in a confirm (e.g. publishing a live site). */
  approveConfirm?: DraftReviewConfirm;
  discardConfirm?: DraftReviewConfirm;
  /** Shown on the approve button. Defaults to Approve. */
  approveLabel?: string;
  /** Show Approve even when the open file is not in changedFiles. */
  approveAlways?: boolean;
}

function defaultDiscardConfirm(perFile: boolean, currentFile?: string): DraftReviewConfirm {
  if (perFile && currentFile) {
    return {
      title: `Discard ${currentFile}?`,
      description: "Reset this file to the published version. Other draft files are kept.",
    };
  }
  return {
    title: "Discard draft?",
    description: "Reset to the published version. Unpublished changes will be lost.",
  };
}

export function DraftReviewBar({ onApprove, onDiscard, approving = false, discarding = false, changedFiles, currentFile, onReviewNext, approveConfirm, discardConfirm, approveLabel, approveAlways = false }: DraftReviewBarProps) {
  if (changedFiles && changedFiles.length === 0) return null;

  const currentIndex = currentFile && changedFiles ? changedFiles.indexOf(currentFile) : -1;
  const onChangedFile = currentIndex >= 0;
  const fileAware = Boolean(currentFile) && Boolean(changedFiles);
  const showDecide = !fileAware || onChangedFile;
  const showApprove = showDecide || approveAlways;
  const showNext = fileAware && Boolean(onReviewNext) && (!onChangedFile || (changedFiles?.length ?? 0) > 1);
  const perFile = fileAware && onChangedFile;
  const discard = discardConfirm ?? defaultDiscardConfirm(perFile, currentFile);
  const approveText = approveLabel ?? "Approve";

  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-lg">
      {showNext ? (
        <Button size="xs" classNames={{ content: "font-semibold" }} icon={<Icon name="arrow-forward" size={12} />} onClick={onReviewNext}>
          {onChangedFile ? "Next file" : "Review next file"}
        </Button>
      ) : null}
      {showDecide ? (
        <Popconfirm title={discard.title} description={discard.description} okText="Discard" okType="danger" cancelText="Cancel" onConfirm={onDiscard} styles={{ root: { width: 280 } }}>
          <Button size="xs" color="default" variant="filled" classNames={{ content: "font-semibold" }} icon={<Icon name="refresh" size={12} />} loading={discarding}>
            Discard
          </Button>
        </Popconfirm>
      ) : null}
      {showApprove ? (
        approveConfirm ? (
          <Popconfirm title={approveConfirm.title} description={approveConfirm.description} okText="Approve" okButtonProps={{ type: "primary" }} cancelText="Cancel" onConfirm={onApprove} styles={{ root: { width: 280 } }}>
            <Button size="xs" type="primary" className="bg-success hover:bg-success/90 active:bg-success/80" classNames={{ content: "font-semibold" }} icon={<Icon name="check" size={12} />} loading={approving}>
              {approveText}
            </Button>
          </Popconfirm>
        ) : (
          <Button size="xs" type="primary" className="bg-success hover:bg-success/90 active:bg-success/80" classNames={{ content: "font-semibold" }} icon={<Icon name="check" size={12} />} loading={approving} onClick={onApprove}>
            {approveText}
          </Button>
        )
      ) : null}
    </div>
  );
}
