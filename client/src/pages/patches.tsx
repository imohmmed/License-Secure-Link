import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Package,
  Plus,
  MoreVertical,
  Terminal,
  Trash2,
  User,
  Users,
  Globe,
  Clock,
  CheckCircle,
  Copy,
  Key,
  Shield,
} from "lucide-react";
import type { PatchToken } from "@shared/schema";

function PatchStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    pending: { label: "بانتظار التفعيل", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 no-default-hover-elevate no-default-active-elevate" },
    used: { label: "مُستخدم", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate" },
    revoked: { label: "ملغي", className: "bg-red-500/15 text-red-600 dark:text-red-400 no-default-hover-elevate no-default-active-elevate" },
  };
  const v = variants[status] || variants.pending;
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}

export default function Patches() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetails, setShowDetails] = useState<PatchToken | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: patches, isLoading } = useQuery<PatchToken[]>({
    queryKey: ["/api/patches"],
    refetchOnMount: "always",
    refetchInterval: 30000,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/patches", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setShowCreate(false);
      toast({ title: "تم إنشاء الباتش بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/patches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/patches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setShowDetails(null);
      toast({ title: "تم الحذف بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const copyCommand = (token: string) => {
    const cmd = `curl -sL https://lic.tecn0link.net/api/patch-run/${token} | sudo bash`;
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-patches-title">الباتشات</h1>
          <p className="text-muted-foreground text-sm mt-1">إنشاء ملفات تثبيت تلقائية للعملاء البعيدين</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-patch">
          <Plus className="h-4 w-4 ml-2" />
          باتش جديد
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : patches && patches.length > 0 ? (
        <div className="grid gap-3">
          {patches.map((patch) => (
            <Card
              key={patch.id}
              className="hover-elevate cursor-pointer transition-all"
              onClick={() => setShowDetails(patch)}
              data-testid={`card-patch-${patch.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 flex-shrink-0">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {patch.personName}
                        </span>
                        <PatchStatusBadge status={patch.status} />
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {patch.durationDays || 30} يوم
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {patch.maxUsers || 100} مستخدم
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          {patch.maxSites || 1} موقع
                        </span>
                        {patch.status === "used" && patch.activatedHostname && (
                          <span className="flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            {patch.activatedHostname}
                          </span>
                        )}
                        {patch.status === "used" && patch.usedAt && (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-emerald-500" />
                            فُعّل {new Date(patch.usedAt).toLocaleDateString("ar-IQ")}
                          </span>
                        )}
                        {patch.status === "used" && patch.licenseId && (
                          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate text-[10px]">مُرخّص</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-actions-patch-${patch.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {patch.status === "pending" && (
                          <DropdownMenuItem
                            onClick={() => copyCommand(patch.token)}
                            data-testid={`action-copy-command-${patch.id}`}
                          >
                            <Terminal className="h-4 w-4 ml-2" />
                            نسخ أمر التثبيت
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => copyToken(patch.token)}
                          data-testid={`action-copy-token-${patch.id}`}
                        >
                          <Copy className="h-4 w-4 ml-2" />
                          نسخ التوكن
                        </DropdownMenuItem>
                        {patch.licenseId && (
                          <DropdownMenuItem
                            onClick={() => {
                              window.location.href = "/licenses";
                            }}
                            data-testid={`action-view-license-${patch.id}`}
                          >
                            <Key className="h-4 w-4 ml-2" />
                            عرض الترخيص
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => deleteMutation.mutate(patch.id)}
                          className="text-red-600 dark:text-red-400"
                          data-testid={`action-delete-patch-${patch.id}`}
                        >
                          <Trash2 className="h-4 w-4 ml-2" />
                          {patch.status === "used" ? "إلغاء" : "حذف"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-sm">لا توجد باتشات</p>
            <p className="text-muted-foreground/70 text-xs mt-1">أنشئ باتش وأعطِ الشخص أمر التثبيت لينفذه على سيرفره</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 ml-2" />
              إنشاء باتش جديد
            </Button>
          </CardContent>
        </Card>
      )}

      <CreatePatchDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      <PatchDetailsDialog
        patch={showDetails}
        onClose={() => setShowDetails(null)}
        onCopyCommand={copyCommand}
        onDelete={(id) => deleteMutation.mutate(id)}
        onCopyToken={copyToken}
        copied={copied}
      />
    </div>
  );
}

function CreatePatchDialog({ open, onOpenChange, onSubmit, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    personName: "",
    targetIp: "",
    maxUsers: "1000",
    maxSites: "1",
    durationDays: "30",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      personName: form.personName,
      targetIp: form.targetIp || null,
      maxUsers: parseInt(form.maxUsers) || 1000,
      maxSites: parseInt(form.maxSites) || 1,
      durationDays: parseInt(form.durationDays) || 30,
      notes: form.notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>إنشاء باتش جديد</DialogTitle>
          <DialogDescription>أدخل بيانات الشخص ومعلومات الترخيص — عند تشغيل الباتش يُنشأ الترخيص تلقائياً</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>اسم الشخص</Label>
            <Input
              value={form.personName}
              onChange={(e) => setForm({ ...form, personName: e.target.value })}
              placeholder="مثال: أحمد - العراق"
              required
              data-testid="input-person-name"
            />
          </div>
          <div className="space-y-2">
            <Label>IP السيرفر (اختياري)</Label>
            <Input
              value={form.targetIp}
              onChange={(e) => setForm({ ...form, targetIp: e.target.value })}
              placeholder="مثال: 103.113.71.180"
              dir="ltr"
              data-testid="input-target-ip"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>المدة (أيام)</Label>
              <Input
                type="number"
                value={form.durationDays}
                onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                min="1"
                required
                data-testid="input-duration-days"
              />
            </div>
            <div className="space-y-2">
              <Label>أقصى مستخدمين</Label>
              <Input
                type="number"
                value={form.maxUsers}
                onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
                min="1"
                required
                data-testid="input-max-users"
              />
            </div>
            <div className="space-y-2">
              <Label>أقصى مواقع</Label>
              <Input
                type="number"
                value={form.maxSites}
                onChange={(e) => setForm({ ...form, maxSites: e.target.value })}
                min="1"
                required
                data-testid="input-max-sites"
              />
            </div>
          </div>
          <p className="text-muted-foreground/70 text-[11px]">العميل ينفذ أمر التثبيت على سيرفره → يتسجل HWID تلقائياً → يُنشأ الترخيص فوراً بالإعدادات أعلاه</p>
          <div className="space-y-2">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="أي ملاحظات عن هذا الباتش..."
              data-testid="input-patch-notes"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending} data-testid="button-submit-patch">
              {isPending ? "جاري الإنشاء..." : "إنشاء الباتش"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PatchDetailsDialog({ patch, onClose, onCopyCommand, onDelete, onCopyToken, copied }: {
  patch: PatchToken | null;
  onClose: () => void;
  onCopyCommand: (token: string) => void;
  onDelete: (id: string) => void;
  onCopyToken: (token: string) => void;
  copied: boolean;
}) {
  const { data: freshPatches } = useQuery<PatchToken[]>({ queryKey: ["/api/patches"] });
  const live = patch ? freshPatches?.find((p) => p.id === patch.id) || patch : null;

  if (!live) return null;

  return (
    <Dialog open={!!patch} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            تفاصيل الباتش
          </DialogTitle>
          <DialogDescription>معلومات الباتش وحالته</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">اسم الشخص</span>
            <span className="font-medium">{live.personName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">الحالة</span>
            <PatchStatusBadge status={live.status} />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">المدة</span>
            <span>{live.durationDays || 30} يوم</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">أقصى مستخدمين</span>
            <span>{live.maxUsers || 100}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">أقصى مواقع</span>
            <span>{live.maxSites || 1}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">تاريخ الإنشاء</span>
            <span>{new Date(live.createdAt).toLocaleString("ar-IQ")}</span>
          </div>
          {live.activatedHostname && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">اسم السيرفر</span>
              <span>{live.activatedHostname}</span>
            </div>
          )}
          {live.activatedIp && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">عنوان IP</span>
              <span dir="ltr" className="font-mono text-xs">{live.activatedIp}</span>
            </div>
          )}
          {live.status === "used" && !live.licenseId && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">الترخيص</span>
              <Badge variant="outline" className="bg-amber-500/15 text-amber-600 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate">بانتظار إنشاء الترخيص</Badge>
            </div>
          )}
          {live.usedAt && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">تاريخ التفعيل</span>
              <span>{new Date(live.usedAt).toLocaleString("ar-IQ")}</span>
            </div>
          )}
          {live.notes && (
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">ملاحظات</span>
              <span className="text-left max-w-[200px]">{live.notes}</span>
            </div>
          )}

          {live.status === "pending" && (
            <div className="pt-2 border-t space-y-2">
              <span className="text-muted-foreground text-xs">أمر التثبيت</span>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-3 py-2 rounded font-mono flex-1 break-all select-all" dir="ltr" data-testid="text-install-command">
                  curl -sL https://lic.tecn0link.net/api/patch-run/{live.token} | sudo bash
                </code>
                <Button size="icon" variant="ghost" onClick={() => onCopyCommand(live.token)} data-testid="button-copy-command">
                  {copied ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-muted-foreground/60 text-[11px]">يشغّل الشخص هذا الأمر على سيرفره كـ root - كل شي يتنفذ بالذاكرة</p>
            </div>
          )}

          <div className="pt-2 border-t">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs">التوكن</span>
              <div className="flex items-center gap-1">
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                  {live.token.substring(0, 20)}...
                </code>
                <Button size="icon" variant="ghost" onClick={() => onCopyToken(live.token)} data-testid="button-copy-token">
                  {copied ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>

          {live.licenseId && (
            <div className="pt-2 border-t">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">الترخيص المرتبط</span>
                <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate font-mono text-xs">{live.licenseId}</Badge>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {live.status === "pending" && (
            <Button onClick={() => onCopyCommand(live.token)} data-testid="button-copy-install-command">
              <Terminal className="h-4 w-4 ml-2" />
              نسخ أمر التثبيت
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => onDelete(live.id)}
            data-testid="button-delete-patch"
          >
            <Trash2 className="h-4 w-4 ml-2" />
            {live.status === "used" ? "إلغاء الباتش" : "حذف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
