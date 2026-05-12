import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Plus, Search, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "../../context/CompanyContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";
import { EmptyState } from "../../components/EmptyState";
import {
  businessRetailApi,
  LOYALTY_TIER_COLORS,
  type LoyaltyMember,
  type LoyaltyTier,
} from "../../api/business-retail";

const TIER_ORDER: LoyaltyTier[] = ["bronze", "silver", "gold", "platinum"];

export function RetailLoyaltyPage() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const companyId = selectedCompany?.id ?? "";

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<LoyaltyMember | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Business", href: "/business" },
      { label: "Retail", href: "/business/retail" },
      { label: "Loyalty" },
    ]);
  }, [setBreadcrumbs]);

  const membersQuery = useQuery({
    queryKey: ["retail", companyId, "loyalty", search, tierFilter],
    queryFn: () =>
      businessRetailApi.listMembers(companyId, {
        q: search || undefined,
        tier: tierFilter || undefined,
      }),
    enabled: !!companyId,
  });

  if (!selectedCompany) return <PageSkeleton variant="list" />;

  const members = membersQuery.data?.members ?? [];
  const byTier: Record<LoyaltyTier, number> = {
    bronze: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
  };
  for (const m of members) byTier[m.tier] += 1;
  const totalEarned = members.reduce((s, m) => s + m.pointsLifetimeEarned, 0);
  const totalRedeemed = members.reduce((s, m) => s + m.pointsLifetimeRedeemed, 0);
  const redemptionRate =
    totalEarned > 0 ? Math.round((totalRedeemed / totalEarned) * 100) : 0;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Loyalty program</h1>
          <p className="text-sm text-muted-foreground">
            10 points per KWD spent · 100 points = 1 KWD redeemable.
          </p>
        </div>
        <Button onClick={() => setEnrollOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Enroll member
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Total members
            </div>
            <div className="mt-1 text-2xl font-bold">{members.length}</div>
          </CardContent>
        </Card>
        {TIER_ORDER.map((t) => (
          <Card key={t}>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground capitalize">
                {t} tier
              </div>
              <div className="mt-1 text-2xl font-bold">{byTier[t]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Lifetime points earned
            </div>
            <div className="mt-1 text-2xl font-bold">{totalEarned.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Lifetime points redeemed
            </div>
            <div className="mt-1 text-2xl font-bold">{totalRedeemed.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">
              Redemption rate
            </div>
            <div className="mt-1 text-2xl font-bold">{redemptionRate}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-72 rounded-md border border-input bg-transparent pl-8 pr-3 text-sm outline-none"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">All tiers</option>
          {TIER_ORDER.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Members table */}
      {membersQuery.isLoading ? (
        <PageSkeleton variant="list" />
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No loyalty members enrolled yet."
          action="Enroll first member"
          onAction={() => setEnrollOpen(true)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2 text-right">Earned</th>
                  <th className="px-3 py-2 text-right">Redeemed</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-accent/50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{m.customerName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{m.code}</div>
                    </td>
                    <td className="px-3 py-2 font-mono">{m.phone}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium capitalize ${LOYALTY_TIER_COLORS[m.tier]}`}
                      >
                        <Sparkles className="h-3 w-3" />
                        {m.tier}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {m.pointsBalance}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {m.pointsLifetimeEarned}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {m.pointsLifetimeRedeemed}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAdjusting(m)}
                      >
                        Adjust
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <EnrollDialog
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        companyId={companyId}
        onSuccess={() =>
          qc.invalidateQueries({ queryKey: ["retail", companyId, "loyalty"] })
        }
      />
      <AdjustDialog
        member={adjusting}
        onClose={() => setAdjusting(null)}
        companyId={companyId}
        onSuccess={() =>
          qc.invalidateQueries({ queryKey: ["retail", companyId, "loyalty"] })
        }
      />
    </div>
  );
}

function EnrollDialog({
  open,
  onClose,
  companyId,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const enroll = useMutation({
    mutationFn: () =>
      businessRetailApi.enrollMember(companyId, {
        customerId: `walk-in-${Date.now()}`,
        customerName: name,
        phone,
        email: email || undefined,
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
      setName("");
      setPhone("");
      setEmail("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll loyalty member</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Customer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <input
            type="tel"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name || phone.length < 4 || enroll.isPending}
            onClick={() => enroll.mutate()}
          >
            <Gift className="mr-1 h-4 w-4" />
            Enroll
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({
  member,
  onClose,
  companyId,
  onSuccess,
}: {
  member: LoyaltyMember | null;
  onClose: () => void;
  companyId: string;
  onSuccess: () => void;
}) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const adjust = useMutation({
    mutationFn: () =>
      businessRetailApi.adjustPoints(companyId, member!.id, {
        points: Math.trunc(Number(points) || 0),
        reason,
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
      setPoints("");
      setReason("");
    },
  });
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust points — {member?.customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Current balance: {member?.pointsBalance ?? 0} points
          </p>
          <input
            type="number"
            placeholder="Points (negative to deduct)"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <input
            type="text"
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!points || !reason || adjust.isPending}
            onClick={() => adjust.mutate()}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
