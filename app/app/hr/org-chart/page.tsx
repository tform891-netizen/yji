"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/types/database";
import { getStaffDisplayName, getStaffInitials } from "@/lib/hr/staff-utils";
import { Building2, Users, ChevronRight, ChevronDown, Briefcase, UserX } from "lucide-react";

type Dept = Database["public"]["Tables"]["hr_departments"]["Row"];
type Staff = Database["public"]["Tables"]["hr_staff"]["Row"];
type Position = Database["public"]["Tables"]["hr_positions"]["Row"];

type PositionWithHolder = Position & {
  holder: { id: string; staff_number: string; first_name: string | null; last_name: string | null; photo_url: string | null; status: string } | null;
};

type StaffWithAssignment = Staff & {
  hr_assignments: {
    id: string;
    is_primary: boolean;
    end_date: string | null;
    department_id: string;
    position_id: string | null;
    hr_positions: { name: string } | null;
  }[];
};

type DeptNode = Dept & {
  children: DeptNode[];
  positions: PositionWithHolder[];
  staff: StaffWithAssignment[];
};

const LEVEL_LABELS: Record<number, string> = {
  1: "Direction générale",
  2: "Sous-direction",
  3: "Service",
  4: "Unité",
  5: "Cellule",
};

export default function OrgChartPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<DeptNode[]>([]);
  const [unassignedStaff, setUnassignedStaff] = useState<StaffWithAssignment[]>([]);

  const fetchOrgChart = useCallback(async () => {
    if (!profile?.institution_id) return;
    setLoading(true);
    setError(null);
    try {
      const instId = profile.institution_id;
      const [deptRes, staffRes, posRes, assignRes] = await Promise.all([
        supabase.from("hr_departments").select("*").eq("institution_id", instId).order("level", { ascending: true }).order("name", { ascending: true }),
        supabase
          .from("hr_staff")
          .select(`
            *,
            hr_assignments(
              id, is_primary, end_date, department_id, position_id,
              hr_positions(name)
            )
          `)
          .eq("institution_id", instId)
          .order("last_name", { ascending: true }),
        supabase.from("hr_positions").select("*").eq("institution_id", instId).eq("is_active", true).order("name", { ascending: true }),
        supabase
          .from("hr_assignments")
          .select("id, staff_id, position_id, is_primary, end_date")
          .is("end_date", null)
          .order("is_primary", { ascending: false }),
      ]);

      if (deptRes.error) throw deptRes.error;
      if (staffRes.error) throw staffRes.error;
      if (posRes.error) throw posRes.error;
      if (assignRes.error) throw assignRes.error;

      const departments = deptRes.data as Dept[];
      const allStaff = (staffRes.data as unknown as StaffWithAssignment[]) ?? [];
      const allPositions = (posRes.data as Position[]) ?? [];
      const allAssignments = (assignRes.data as { id: string; staff_id: string; position_id: string | null; is_primary: boolean; end_date: string | null }[]) ?? [];

      const staffMap = new Map<string, Staff>();
      allStaff.forEach((s) => staffMap.set(s.id, s));

      const positionHolders = new Map<string, string>();
      allAssignments.forEach((a) => {
        if (a.position_id && !positionHolders.has(a.position_id)) {
          positionHolders.set(a.position_id, a.staff_id);
        }
      });

      const deptMap = new Map<string, DeptNode>();
      departments.forEach((d) => {
        deptMap.set(d.id, { ...d, children: [], positions: [], staff: [] });
      });

      const roots: DeptNode[] = [];
      departments.forEach((d) => {
        const node = deptMap.get(d.id)!;
        if (d.parent_id && deptMap.has(d.parent_id)) {
          deptMap.get(d.parent_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      });

      allPositions.forEach((p) => {
        if (p.department_id && deptMap.has(p.department_id)) {
          const holderId = positionHolders.get(p.id);
          const holderStaff = holderId ? staffMap.get(holderId) : null;
          deptMap.get(p.department_id)!.positions.push({
            ...p,
            holder: holderStaff
              ? {
                  id: holderStaff.id,
                  staff_number: holderStaff.staff_number,
                  first_name: holderStaff.first_name,
                  last_name: holderStaff.last_name,
                  photo_url: holderStaff.photo_url,
                  status: holderStaff.status,
                }
              : null,
          });
        }
      });

      const assignedIds = new Set<string>();
      allStaff.forEach((s) => {
        const activeAssignments = (s.hr_assignments ?? []).filter((a) => !a.end_date);
        activeAssignments.forEach((a) => {
          if (a.department_id && deptMap.has(a.department_id)) {
            deptMap.get(a.department_id)!.staff.push(s);
            assignedIds.add(s.id);
          }
        });
      });

      setTree(roots);
      setUnassignedStaff(allStaff.filter((s) => !assignedIds.has(s.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [profile?.institution_id]);

  useEffect(() => { fetchOrgChart(); }, [fetchOrgChart]);

  if (loading) {
    return <div><PageHeader title="Organigramme" description="Vue arborescente de l'organisation" /><LoadingState /></div>;
  }
  if (error) {
    return <div><PageHeader title="Organigramme" description="Vue arborescente" /><ErrorState message={error} action={<Button variant="outline" size="sm" onClick={fetchOrgChart}>Réessayer</Button>} /></div>;
  }

  const hasData = tree.length > 0 || unassignedStaff.length > 0;

  return (
    <div>
      <PageHeader title="Organigramme" description="Structures et postes : Direction → Service → Postes & Personnel" />

      {!hasData ? (
        <Card className="p-4">
          <EmptyState title="Aucune organisation" message="Créez des directions et des postes pour visualiser l'organigramme." />
        </Card>
      ) : (
        <div className="space-y-4">
          {tree.length === 0 && unassignedStaff.length > 0 && (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground mb-3">
                Aucune direction créée. Le personnel non affecté apparaît ci-dessous.
              </p>
            </Card>
          )}

          {tree.map((node) => (
            <DeptTreeNode key={node.id} node={node} depth={0} />
          ))}

          {unassignedStaff.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Personnel non affecté</h3>
                <Badge variant="secondary">{unassignedStaff.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {unassignedStaff.map((s) => (
                  <StaffCard key={s.id} staff={s} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function DeptTreeNode({ node, depth }: { node: DeptNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const hasPositions = node.positions.length > 0;
  const hasStaff = node.staff.length > 0;
  const hasContent = hasChildren || hasPositions || hasStaff;
  const vacantCount = node.positions.filter((p) => !p.holder).length;

  return (
    <Card className="p-0 overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className="flex items-center gap-3 p-4 border-b border-border"
          style={{ paddingLeft: `${16 + depth * 20}px` }}
        >
          {hasContent && (
            <CollapsibleTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </CollapsibleTrigger>
          )}
          <div className="flex items-center gap-2 flex-1">
            <Building2 className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">{node.name}</span>
            <Badge variant="outline" className="text-xs">{LEVEL_LABELS[node.level] ?? `Niveau ${node.level}`}</Badge>
            <span className="text-xs text-muted-foreground">{node.code}</span>
          </div>
          <div className="flex items-center gap-2">
            {hasPositions && <Badge variant="secondary" className="text-xs">{node.positions.length} poste{node.positions.length > 1 ? "s" : ""}</Badge>}
            {vacantCount > 0 && <Badge variant="outline" className="text-xs text-amber-600">{vacantCount} vacant{vacantCount > 1 ? "s" : ""}</Badge>}
            {hasChildren && <Badge variant="outline" className="text-xs">{node.children.length} sous.</Badge>}
            {!node.is_active && <Badge variant="secondary">Inactif</Badge>}
          </div>
        </div>

        <CollapsibleContent>
          {hasPositions && (
            <div
              className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              style={{ paddingLeft: `${16 + depth * 20}px` }}
            >
              {node.positions.map((p) => (
                <PositionCard key={p.id} position={p} />
              ))}
            </div>
          )}

          {hasStaff && (
            <div
              className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              style={{ paddingLeft: `${16 + depth * 20}px` }}
            >
              {node.staff.map((s) => (
                <StaffCard key={s.id} staff={s} />
              ))}
            </div>
          )}

          {hasChildren && (
            <div className="border-t border-border">
              {node.children.map((child) => (
                <DeptTreeNode key={child.id} node={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function PositionCard({ position }: { position: PositionWithHolder }) {
  const { holder } = position;
  const isVacant = !holder;

  if (isVacant) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3 bg-muted/30">
        <div className="w-10 h-10 shrink-0 rounded-full bg-muted flex items-center justify-center">
          <UserX className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate text-muted-foreground">Poste vacant</p>
          <p className="text-xs text-muted-foreground truncate">{position.name}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs text-amber-600">Vacant</Badge>
      </div>
    );
  }

  const displayName = getStaffDisplayName(holder!);
  const initials = getStaffInitials(holder!);

  const statusColors: Record<string, "default" | "secondary"> = {
    active: "default",
    on_leave: "secondary",
    terminated: "secondary",
    retired: "secondary",
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-card hover:shadow-sm transition-shadow">
      <Avatar className="w-10 h-10 shrink-0">
        {holder!.photo_url && <AvatarImage src={holder!.photo_url} alt={displayName} />}
        <AvatarFallback className="text-xs bg-primary text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
          <Briefcase className="w-3 h-3 shrink-0" />
          {position.name}
        </p>
      </div>
      <Badge variant={statusColors[holder!.status] ?? "secondary"} className="shrink-0 text-xs">
        {holder!.status === "active" ? "Actif" : holder!.status === "on_leave" ? "Congé" : holder!.status}
      </Badge>
    </div>
  );
}

function StaffCard({ staff }: { staff: StaffWithAssignment }) {
  const displayName = getStaffDisplayName(staff);
  const initials = getStaffInitials(staff);
  const primaryAssignment = (staff.hr_assignments ?? []).find((a) => a.is_primary && !a.end_date);
  const positionName = primaryAssignment?.hr_positions?.name;

  const statusColors: Record<string, "default" | "secondary"> = {
    active: "default",
    on_leave: "secondary",
    terminated: "secondary",
    retired: "secondary",
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3 bg-card hover:shadow-sm transition-shadow">
      <Avatar className="w-10 h-10 shrink-0">
        {staff.photo_url && <AvatarImage src={staff.photo_url} alt={displayName} />}
        <AvatarFallback className="text-xs bg-primary text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground truncate">
          {positionName ?? staff.staff_number}
          {positionName && ` · ${staff.staff_number}`}
        </p>
      </div>
      <Badge variant={statusColors[staff.status] ?? "secondary"} className="shrink-0 text-xs">
        {staff.status === "active" ? "Actif" : staff.status === "on_leave" ? "Congé" : staff.status}
      </Badge>
    </div>
  );
}
