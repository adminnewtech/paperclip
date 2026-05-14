import { AlertTriangle, Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PreviewRow } from "../../api/business-import";

interface ImportPreviewTableProps {
  rows: PreviewRow[];
}

/**
 * Renders the first N preview rows of an import side-by-side with the
 * mapped values. Issues (validation errors) and duplicate flags are shown
 * as chips per row so the user can spot problems before committing.
 */
export function ImportPreviewTable({ rows }: ImportPreviewTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No rows to preview.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Source data</th>
            <th className="px-3 py-2 font-medium">Mapped data</th>
            <th className="px-3 py-2 font-medium">Issues</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.rowIndex}
              className={`border-t border-border ${
                row.issues.length > 0 ? "bg-destructive/5" : ""
              }`}
            >
              <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                {row.rowIndex + 1}
              </td>
              <td className="px-3 py-2 align-top">
                <div className="flex flex-col gap-1">
                  {row.issues.length === 0 ? (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="h-3 w-3" />
                      Valid
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Invalid
                    </Badge>
                  )}
                  {row.isDuplicate && (
                    <Badge variant="outline" className="gap-1">
                      <Copy className="h-3 w-3" />
                      Duplicate
                    </Badge>
                  )}
                </div>
              </td>
              <td className="max-w-[260px] px-3 py-2 align-top">
                <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {Object.entries(row.sourceData)
                    .filter(([, v]) => v != null && v !== "")
                    .map(([k, v]) => `${k}: ${v}`)
                    .join("\n")}
                </pre>
              </td>
              <td className="max-w-[280px] px-3 py-2 align-top">
                <pre className="whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(row.mappedData, null, 2)}
                </pre>
              </td>
              <td className="max-w-[200px] px-3 py-2 align-top">
                {row.issues.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <ul className="space-y-1 text-xs text-destructive">
                    {row.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
