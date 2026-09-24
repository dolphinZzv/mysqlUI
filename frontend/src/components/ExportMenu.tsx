import { toast } from "sonner";
import { Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { tableExportUrl, triggerDownload } from "@/lib/api";
import type { FilterCondition } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  connectionId: string;
  database: string;
  table: string;
  orderBy?: string;
  filters?: FilterCondition[];
}

export function ExportMenu({ connectionId, database, table, orderBy, filters }: Props) {
  const doExport = (format: "csv" | "json" | "sql") => {
    triggerDownload(tableExportUrl(connectionId, database, table, format, orderBy, filters));
    toast.success(`Exporting ${table}.${format}`, {
      description: "The download should start shortly.",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export current table</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => doExport("csv")}>
          <FileSpreadsheet /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => doExport("json")}>
          <FileJson /> JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => doExport("sql")}>
          <FileText /> SQL (structure + inserts)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
