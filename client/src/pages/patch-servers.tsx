import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Server,
  MoreVertical,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Edit,
  Terminal,
  Hash,
  User,
  MonitorSmartphone,
} from "lucide-react";
import type { PatchToken } from "@shared/schema";

export default function PatchServers() {
  const { toast } = useToast();
  const [editPatch, setEditPatch] = useState<PatchToken | null>(null);

  const { data: patchServers, isLoading } = useQuery<PatchToken[]>({
    queryKey: ["/api/patch-servers"],
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/patch-servers/${id}/test`);
      return res.json();
    },
    onSuccess: (data: any, id: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/patch-servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      if (data.connected) {
        toast({ title: "الاتصال ناجح", description: `Hardware ID: ${data.hardwareId || "N/A"}` });
      } else {
        toast({ title: "فشل الاتصال", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ في الاتصال", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, personName }: { id: string; personName: string }) => {
      const res = await apiRequest("PATCH", `/api/patch-servers/${id}`, { personName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patch-servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setEditPatch(null);
      toast({ title: "تم تحديث سيرفر الباتش" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/patch-servers/${id}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/patch-servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/patches/available"] });
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      if (data.suspendedLicense) {
        toast({ title: "تم حذف سيرفر الباتش", description: `الترخيص ${data.suspendedLicense} تم إيقافه تلقائياً` });
      } else {
        toast({ title: "تم حذف سيرفر الباتش" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-patch-servers-title">سيرفرات باتشات</h1>
          <p className="text-muted-foreground text-sm mt-1">السيرفرات المسجلة عبر الباتشات المتصلة</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : patchServers && patchServers.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {patchServers.map((patch) => (
            <Card
              key={patch.id}
              className="hover-elevate transition-all"
              data-testid={`card-patch-server-${patch.id}`}
            >
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 flex-shrink-0">
                      <Server className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm" data-testid={`text-patch-name-${patch.id}`}>{patch.personName}</h3>
                      <p className="text-xs text-muted-foreground font-mono" data-testid={`text-patch-ip-${patch.id}`}>{patch.activatedIp || "—"}</p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-patch-actions-${patch.id}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => testConnectionMutation.mutate(patch.id)}
                        data-testid={`action-test-patch-${patch.id}`}
                      >
                        <RefreshCw className="h-4 w-4 ml-2" />
                        اختبار الاتصال
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setEditPatch(patch)}
                        data-testid={`action-edit-patch-${patch.id}`}
                      >
                        <Edit className="h-4 w-4 ml-2" />
                        تعديل
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          const msg = patch.licenseId
                            ? "هل أنت متأكد؟ سيتم إيقاف الترخيص المرتبط تلقائياً"
                            : "هل أنت متأكد من حذف سيرفر الباتش؟";
                          if (confirm(msg)) {
                            deleteMutation.mutate(patch.id);
                          }
                        }}
                        data-testid={`action-delete-patch-${patch.id}`}
                      >
                        <Trash2 className="h-4 w-4 ml-2" />
                        حذف
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Hash className="h-3 w-3" /> البورت
                    </span>
                    <span className="font-mono">22</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <User className="h-3 w-3" /> Hostname
                    </span>
                    <span className="font-mono" data-testid={`text-patch-hostname-${patch.id}`}>{patch.activatedHostname || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Terminal className="h-3 w-3" /> Hardware ID
                    </span>
                    <span className="font-mono text-xs truncate max-w-[120px]" data-testid={`text-patch-hwid-${patch.id}`}>
                      {patch.hardwareId ? patch.hardwareId.substring(0, 10) + "..." : "غير محدد"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t">
                  <Badge
                    variant="outline"
                    className={
                      patch.licenseId
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate"
                        : "bg-amber-500/15 text-amber-600 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate"
                    }
                    data-testid={`status-patch-${patch.id}`}
                  >
                    {patch.licenseId ? (
                      <>
                        <Wifi className="h-3 w-3 ml-1" /> مرخص
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-3 w-3 ml-1" /> بانتظار الترخيص
                      </>
                    )}
                  </Badge>
                  {patch.usedAt && (
                    <span className="text-xs text-muted-foreground">
                      تسجيل: {new Date(patch.usedAt).toLocaleTimeString("ar-IQ")}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MonitorSmartphone className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-sm" data-testid="text-no-patch-servers">لا توجد سيرفرات باتشات مسجلة</p>
          </CardContent>
        </Card>
      )}

      <EditPatchDialog
        patch={editPatch}
        onOpenChange={(v) => { if (!v) setEditPatch(null); }}
        onSubmit={(personName) => {
          if (editPatch) {
            updateMutation.mutate({ id: editPatch.id, personName });
          }
        }}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}

function EditPatchDialog({ patch, onOpenChange, onSubmit, isPending }: {
  patch: PatchToken | null;
  onOpenChange: (v: boolean) => void;
  onSubmit: (personName: string) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");

  const handleOpen = (v: boolean) => {
    if (v && patch) {
      setName(patch.personName);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={!!patch} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل سيرفر الباتش</DialogTitle>
          <DialogDescription>تعديل بيانات سيرفر الباتش المسجل</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(name); }} className="space-y-4">
          <div className="space-y-2">
            <Label>اسم العميل</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم الشخص"
              required
              data-testid="input-patch-name"
            />
          </div>
          {patch && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between gap-2"><span>IP:</span><span className="font-mono">{patch.activatedIp || "—"}</span></div>
              <div className="flex justify-between gap-2"><span>Hostname:</span><span className="font-mono">{patch.activatedHostname || "—"}</span></div>
              <div className="flex justify-between gap-2"><span>HWID:</span><code className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{patch.hardwareId ? patch.hardwareId.substring(0, 12) + "..." : "—"}</code></div>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isPending} data-testid="button-submit-patch-edit">
              {isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
