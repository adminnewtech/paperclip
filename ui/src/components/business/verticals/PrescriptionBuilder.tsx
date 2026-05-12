import { useState } from "react";
import { Pill, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Prescription } from "../../../api/business-clinics";

interface PrescriptionBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drugList: string[];
  onSubmit: (rx: Prescription) => void;
  pending?: boolean;
}

const FREQUENCY_OPTIONS = [
  "Once daily",
  "Twice daily",
  "Three times daily",
  "Four times daily",
  "Every 4 hours",
  "Every 6 hours",
  "Every 8 hours",
  "As needed",
  "Before meals",
  "After meals",
  "At bedtime",
];

export function PrescriptionBuilder({
  open,
  onOpenChange,
  drugList,
  onSubmit,
  pending,
}: PrescriptionBuilderProps) {
  const [drug, setDrug] = useState("");
  const [dosage, setDosage] = useState("");
  const [frequency, setFrequency] = useState("Twice daily");
  const [durationDays, setDurationDays] = useState(7);
  const [quantity, setQuantity] = useState("");
  const [refillsAllowed, setRefillsAllowed] = useState(0);
  const [instructions, setInstructions] = useState("");

  function reset() {
    setDrug("");
    setDosage("");
    setFrequency("Twice daily");
    setDurationDays(7);
    setQuantity("");
    setRefillsAllowed(0);
    setInstructions("");
  }

  function handleSubmit() {
    if (!drug.trim() || !dosage.trim()) return;
    onSubmit({
      drug: drug.trim(),
      dosage: dosage.trim(),
      frequency,
      durationDays,
      quantity: quantity.trim() || undefined,
      refillsAllowed,
      instructions: instructions.trim() || undefined,
    });
    reset();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="h-4 w-4" /> Add prescription
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="rx-drug">Drug</Label>
            <Input
              id="rx-drug"
              value={drug}
              onChange={(e) => setDrug(e.target.value)}
              placeholder="e.g. Amoxicillin"
              list="rx-drug-list"
              autoFocus
            />
            <datalist id="rx-drug-list">
              {drugList.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rx-dosage">Dosage</Label>
              <Input
                id="rx-dosage"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="500mg"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rx-freq">Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="rx-freq">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rx-duration">Days</Label>
              <Input
                id="rx-duration"
                type="number"
                min={1}
                value={durationDays}
                onChange={(e) =>
                  setDurationDays(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rx-qty">Quantity</Label>
              <Input
                id="rx-qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="30 tablets"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rx-refills">Refills</Label>
              <Input
                id="rx-refills"
                type="number"
                min={0}
                value={refillsAllowed}
                onChange={(e) =>
                  setRefillsAllowed(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rx-instructions">Instructions to patient</Label>
            <Textarea
              id="rx-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder="Take with food. Complete the full course."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || !drug.trim() || !dosage.trim()}
          >
            <Plus className="mr-2 h-4 w-4" />
            {pending ? "Adding…" : "Add to prescription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
