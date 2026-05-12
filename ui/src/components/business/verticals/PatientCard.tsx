import { Link } from "@/lib/router";
import { AlertTriangle, Calendar, Phone, ShieldCheck, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ageFromDob, type Patient } from "../../../api/business-clinics";

interface PatientCardProps {
  patient: Patient;
  href?: string;
}

export function PatientCard({ patient, href }: PatientCardProps) {
  const age = ageFromDob(patient.dateOfBirth);
  const inner = (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`h-9 w-9 rounded-full flex items-center justify-center text-white ${
                patient.gender === "female"
                  ? "bg-pink-500"
                  : patient.gender === "male"
                    ? "bg-blue-500"
                    : "bg-slate-500"
              }`}
            >
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{patient.fullName}</div>
              <div className="text-xs text-muted-foreground font-mono">
                {patient.code}
              </div>
            </div>
          </div>
          {patient.flagged ? (
            <Badge variant="destructive" className="shrink-0">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Flagged
            </Badge>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {age != null ? `${age}y` : "—"}
            {patient.gender ? ` · ${patient.gender}` : null}
          </div>
          <div className="flex items-center gap-1 text-muted-foreground truncate">
            <Phone className="h-3 w-3" />
            {patient.phone || "—"}
          </div>
          {patient.bloodType && patient.bloodType !== "unknown" ? (
            <div className="text-muted-foreground">
              Blood: <span className="font-medium text-foreground">{patient.bloodType}</span>
            </div>
          ) : null}
          {patient.insurance ? (
            <div className="flex items-center gap-1 text-muted-foreground truncate">
              <ShieldCheck className="h-3 w-3 text-emerald-600" />
              {patient.insurance.provider}
            </div>
          ) : null}
        </div>

        {patient.allergies.length > 0 || patient.chronicConditions.length > 0 ? (
          <div className="mt-3 space-y-1">
            {patient.allergies.length > 0 ? (
              <div className="text-[10px]">
                <span className="font-medium text-amber-600">Allergies:</span>{" "}
                <span className="text-muted-foreground">
                  {patient.allergies.slice(0, 3).join(", ")}
                  {patient.allergies.length > 3
                    ? ` +${patient.allergies.length - 3}`
                    : ""}
                </span>
              </div>
            ) : null}
            {patient.chronicConditions.length > 0 ? (
              <div className="text-[10px]">
                <span className="font-medium text-rose-600">Chronic:</span>{" "}
                <span className="text-muted-foreground">
                  {patient.chronicConditions.slice(0, 3).join(", ")}
                  {patient.chronicConditions.length > 3
                    ? ` +${patient.chronicConditions.length - 3}`
                    : ""}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{patient.totalVisits} visit{patient.totalVisits !== 1 ? "s" : ""}</span>
          {patient.lastVisitAt ? (
            <span>Last: {new Date(patient.lastVisitAt).toLocaleDateString()}</span>
          ) : (
            <span>Never visited</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link to={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}
