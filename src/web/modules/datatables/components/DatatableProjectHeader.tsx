import { FeatureIcon } from "src/components/FeatureIcon";
import { AgentsContentHeader, type BreadcrumbItem, ContentBreadcrumb } from "src/modules/agents/components/ContentBreadcrumb";

interface DatatableProjectHeaderProps {
  projectName: string;
  projectTo?: string;
  tableName?: string | null;
  settings?: boolean;
  schema?: boolean;
}

export function DatatableProjectHeader({ projectName, projectTo, tableName, settings, schema }: DatatableProjectHeaderProps) {
  const feature: BreadcrumbItem = { label: "Datatables", to: "/datatables", icon: <FeatureIcon name="datatables" size={16} variant="sticker" /> };
  const items: BreadcrumbItem[] = settings ? [feature, { label: projectName, to: projectTo }, { label: "Settings" }] : schema ? [feature, { label: projectName, to: projectTo }, { label: "Schema" }] : [feature, { label: projectName }];
  if (!settings && !schema && tableName) items.push({ label: tableName });

  return <AgentsContentHeader left={<ContentBreadcrumb items={items} />} />;
}
