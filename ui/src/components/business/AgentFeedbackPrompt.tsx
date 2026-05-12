import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "../../context/CompanyContext";
import { businessAgentMemoryApi } from "../../api/business-agent-memory";

interface Props {
  actionId: string;
  /** Optional callback fired after a rating is recorded. */
  onFeedbackGiven?: (rating: "thumbs_up" | "thumbs_down") => void;
  /** Compact layout (no comment textarea). */
  compact?: boolean;
}

export function AgentFeedbackPrompt({
  actionId,
  onFeedbackGiven,
  compact = false,
}: Props) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<null | "thumbs_up" | "thumbs_down">(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState<null | "thumbs_up" | "thumbs_down">(null);

  const mut = useMutation({
    mutationFn: (body: {
      rating: "thumbs_up" | "thumbs_down";
      comment?: string;
    }) => businessAgentMemoryApi.giveFeedback(selectedCompanyId!, actionId, body),
    onSuccess: (_data, variables) => {
      setSubmitted(variables.rating);
      setOpen(null);
      onFeedbackGiven?.(variables.rating);
      // Invalidate memory queries so stats refresh.
      void queryClient.invalidateQueries({
        queryKey: ["business", "agent-memory"],
      });
    },
  });

  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        <span>
          Thanks — feedback recorded ({submitted === "thumbs_up" ? "+" : "-"}).
        </span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Thumbs up"
          disabled={mut.isPending}
          onClick={() => mut.mutate({ rating: "thumbs_up" })}
        >
          {mut.isPending && mut.variables?.rating === "thumbs_up" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Thumbs down"
          disabled={mut.isPending}
          onClick={() => mut.mutate({ rating: "thumbs_down" })}
        >
          {mut.isPending && mut.variables?.rating === "thumbs_down" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ThumbsDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Was this helpful?</span>
        <Button
          size="sm"
          variant={open === "thumbs_up" ? "default" : "outline"}
          aria-label="Thumbs up"
          onClick={() => setOpen(open === "thumbs_up" ? null : "thumbs_up")}
          disabled={mut.isPending}
        >
          <ThumbsUp className="mr-1 h-3.5 w-3.5" />
          Yes
        </Button>
        <Button
          size="sm"
          variant={open === "thumbs_down" ? "default" : "outline"}
          aria-label="Thumbs down"
          onClick={() => setOpen(open === "thumbs_down" ? null : "thumbs_down")}
          disabled={mut.isPending}
        >
          <ThumbsDown className="mr-1 h-3.5 w-3.5" />
          No
        </Button>
      </div>
      {open && (
        <div className="space-y-2 rounded border bg-muted/30 p-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              open === "thumbs_up"
                ? "What worked well? (optional)"
                : "What was wrong? (optional)"
            }
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(null);
                setComment("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={mut.isPending}
              onClick={() =>
                mut.mutate({
                  rating: open,
                  comment: comment.trim() || undefined,
                })
              }
            >
              {mut.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Submit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
