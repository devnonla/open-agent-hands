import { Tag } from "devnonla-ui";
import type { JobRun } from "src/common/types";

export const RUN_STATUS_LABEL: Record<JobRun["status"], string> = { success: "Completed", failed: "Failed", running: "Running", queued: "Queued" };

const RUN_STATUS_COLOR: Record<JobRun["status"], string> = { success: "success", failed: "error", running: "processing", queued: "default" };

export function RunStatusTag({ status, className }: { status: JobRun["status"]; className?: string }) {
  return (
    <Tag color={RUN_STATUS_COLOR[status]} className={className}>
      {RUN_STATUS_LABEL[status]}
    </Tag>
  );
}
