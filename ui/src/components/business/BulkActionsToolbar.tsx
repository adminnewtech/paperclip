import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckSquare,
  Download,
  Loader2,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../../context/CompanyContext";
import {
  businessBulkApi,
  type BulkOperationResult,
} from "../../api/business-bulk";

type DialogKind = "status" | "tags" | "owner" | "delete" | null;

interface BulkActionsToolbarProps {
  selectedIds: string[];
  moduleKey: string;
  entityType: string;
  /** Called to clear the selection (e.g. after an action completes). */
  onClear: () => void;
  /** Optional notification hook after a successful operation. */
  onComplete?: (result: BulkOperationResult) => void;
}

/**
 * Floating bulk action bar that appears anchored to the bottom of the
 * viewport whenever entities are selected in a list view. The bar is
 * self-contained: it owns its own dialogs and mutations, so a list view
 * only needs to track `selectedIds` plus a `clear()` callback.
 */
export function BulkActionsToolbar({
  selectedIds,
  moduleKey,
  entityType,
  onClear,
  onComplete,
}: BulkActionsToolbarProps) {
  const { selectedCompanyId } = useCompany();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [statusValue, setStatusValue] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [ownerValue, setOwnerValue] = useState("");
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof businessBulkApi.update>[3]) =>
      businessBulkApi.update(selectedCompanyId!, moduleKey, entityType, body),
    onSuccess: (result) => {
      setResultMessage(
        `${result.successCount} updated, ${result.failedCount} failed`,
      );
      onComplete?.(result);
      onClear();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      businessBulkApi.delete(selectedCompanyId!, moduleKey, entityType, {
        entityIds: selectedIds,
      }),
    onSuccess: (result) => {
      setResultMessage(
        `${result.successCount} deleted, ${result.failedCount} failed`,
      );
      onComplete?.(result);
      onClear();
    },
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      businessBulkApi.exportCsv(selectedCompanyId!, moduleKey, entityType, {
        entityIds: selectedIds,
      }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${moduleKey}-${entityType}-bulk-export.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  const handleClose = () => {
    setDialog(null);
    setStatusValue("");
    setTagInput("");
    setOwnerValue("");
  };

  const applyStatus = () => {
    if (!statusValue.trim() || !selectedCompanyId) return;
    updateMutation.mutate({
      entityIds: selectedIds,
      updates: { status: statusValue.trim() },
    });
    handleClose();
  };

  const applyTags = () => {
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length === 0 || !selectedCompanyId) return;
    updateMutation.mutate({
      entityIds: selectedIds,
      updates: { addTags: tags },
    });
    handleClose();
  };

  const applyOwner = () => {
    if (!ownerValue.trim() || !selectedCompanyId) return;
    updateMutation.mutate({
      entityIds: selectedIds,
      updates: { ownerUserId: ownerValue.trim() },
    });
    handleClose();
  };

  const applyDelete = () => {
    if (!selectedCompanyId) return;
    deleteMutation.mutate();
    handleClose();
  };

  const count = selectedIds.length;
  const busy =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    exportMutation.isPending;

  if (count === 0 && !resultMessage) return null;

  return (
    <>
      <div
        className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-card shadow-lg"
        role="region"
        aria-label="Bulk actions"
      >
        <div className="flex items-center gap-2 px-4 py-2">
          <Badge variant="secondary" className="gap-1">
            <CheckSquare className="h-3 w-3" />
            {count} selected
          </Badge>
          <div className="mx-2 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || count === 0}
            onClick={() => setDialog("status")}
          >
            Update Status
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || count === 0}
            onClick={() => setDialog("tags")}
          >
            <Tag className="mr-1 h-3 w-3" />
            Add Tags
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || count === 0}
            onClick={() => setDialog("owner")}
          >
            <User className="mr-1 h-3 w-3" />
            Assign Owner
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || count === 0}
            onClick={() => exportMutation.mutate()}
          >
            <Download className="mr-1 h-3 w-3" />
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || count === 0}
            onClick={() => setDialog("delete")}
            className="text-destructive"
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
          <div className="mx-2 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setResultMessage(null);
              onClear();
            }}
            aria-label="Clear selection"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
        {resultMessage && (
          <div className="px-4 pb-2 text-xs text-muted-foreground">
            {resultMessage}
          </div>
        )}
      </div>

      <Dialog
        open={dialog === "status"}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-status">New status</Label>
            <Input
              id="bulk-status"
              value={statusValue}
              onChange={(e) => setStatusValue(e.target.value)}
              placeholder="e.g. paid, archived, qualified..."
            />
            <p className="text-xs text-muted-foreground">
              Will be applied to {count} entit{count === 1 ? "y" : "ies"}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={applyStatus} disabled={!statusValue.trim()}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "tags"}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tags</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-tags">Tags (comma-separated)</Label>
            <Input
              id="bulk-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="e.g. urgent, follow-up"
            />
            <p className="text-xs text-muted-foreground">
              New tags will be added to existing tags on each entity.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={applyTags} disabled={!tagInput.trim()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "owner"}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Owner</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-owner">Owner user ID</Label>
            <Input
              id="bulk-owner"
              value={ownerValue}
              onChange={(e) => setOwnerValue(e.target.value)}
              placeholder="user-id"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={applyOwner} disabled={!ownerValue.trim()}>
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {count} entit{count === 1 ? "y" : "ies"}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone. Are you sure you want to permanently
            delete the selected entities?
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={applyDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
