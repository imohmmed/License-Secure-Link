import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Key,
  Plus,
  MoreVertical,
  Play,
  Pause,
  RefreshCw,
  ArrowRightLeft,
  Trash2,
  Search,
  Shield,
  Calendar,
  Users,
  Globe,
  Server,
  Copy,
  CheckCircle,
} from "lucide-react";
import type { License, Server as ServerType } from "@shared/schema";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    active: { label: "نشط", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate" },
    inactive: { label: "غير نشط", className: "bg-muted text-muted-foreground no-default-hover-elevate no-default-active-elevate" },
    suspended: { label: "موقوف", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate" },
    expired: { label: "منتهي", className: "bg-red-500/15 text-red-600 dark:text-red-400 no-default-hover-elevate no-default-active-elevate" },
  };
  const v = variants[status] || variants.inactive;
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}

export default function Licenses() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetails, setShowDetails] = useState<License | null>(null);
  const [showTransfer, setShowTransfer] = useState<License | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: licenses, isLoading } = useQuery<License[]>({
    queryKey: ["/api/licenses"],
  });

  const { data: serversList } = useQuery<ServerType[]>({
    queryKey: ["/api/servers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/licenses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setShowCreate(false);
      toast({ title: "تم إنشاء الترخيص بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/licenses/${id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      toast({ title: "تم تحديث حالة الترخيص" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async ({ id, serverId }: { id: string; serverId: string }) => {
      const res = await apiRequest("POST", `/api/licenses/${id}/transfer`, { serverId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setShowTransfer(null);
      toast({ title: "تم نقل الترخيص بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const extendMutation = useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      const res = await apiRequest("POST", `/api/licenses/${id}/extend`, { days });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      toast({ title: "تم تمديد الترخيص" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/licenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      toast({ title: "تم حذف الترخيص" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const deployMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/licenses/${id}/deploy`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      toast({ title: "تم نشر الترخيص على السيرفر" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ في النشر", description: err.message, variant: "destructive" });
    },
  });

  const filteredLicenses = licenses?.filter((l) => {
    const matchSearch = l.licenseId.toLowerCase().includes(search.toLowerCase()) ||
      l.hardwareId?.toLowerCase().includes(search.toLowerCase()) ||
      l.clientId?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-licenses-title">التراخيص</h1>
          <p className="text-muted-foreground text-sm mt-1">إدارة جميع التراخيص والتحكم بها</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-license">
          <Plus className="h-4 w-4 ml-2" />
          ترخيص جديد
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="بحث بمعرف الترخيص..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
            data-testid="input-search-license"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]" data-testid="select-filter-status">
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="inactive">غير نشط</SelectItem>
            <SelectItem value="suspended">موقوف</SelectItem>
            <SelectItem value="expired">منتهي</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filteredLicenses && filteredLicenses.length > 0 ? (
        <div className="grid gap-3">
          {filteredLicenses.map((license) => (
            <Card
              key={license.id}
              className="hover-elevate cursor-pointer transition-all"
              onClick={() => setShowDetails(license)}
              data-testid={`card-license-${license.id}`}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 flex-shrink-0">
                      <Key className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{license.licenseId}</span>
                        <StatusBadge status={license.status} />
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          {license.hardwareId ? license.hardwareId.substring(0, 16) + "..." : "غير مقفل"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(license.expiresAt).toLocaleDateString("ar-IQ")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {license.maxUsers.toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          {license.maxSites} موقع
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" data-testid={`button-actions-${license.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {license.status !== "active" && (
                          <DropdownMenuItem
                            onClick={() => updateStatusMutation.mutate({ id: license.id, status: "active" })}
                            data-testid={`action-activate-${license.id}`}
                          >
                            <Play className="h-4 w-4 ml-2" />
                            تفعيل
                          </DropdownMenuItem>
                        )}
                        {license.status === "active" && (
                          <DropdownMenuItem
                            onClick={() => updateStatusMutation.mutate({ id: license.id, status: "suspended" })}
                            data-testid={`action-suspend-${license.id}`}
                          >
                            <Pause className="h-4 w-4 ml-2" />
                            إيقاف
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => extendMutation.mutate({ id: license.id, days: 30 })}
                          data-testid={`action-extend-${license.id}`}
                        >
                          <RefreshCw className="h-4 w-4 ml-2" />
                          تمديد 30 يوم
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setShowTransfer(license)}
                          data-testid={`action-transfer-${license.id}`}
                        >
                          <ArrowRightLeft className="h-4 w-4 ml-2" />
                          نقل لسيرفر آخر
                        </DropdownMenuItem>
                        {license.serverId && (
                          <DropdownMenuItem
                            onClick={() => deployMutation.mutate(license.id)}
                            data-testid={`action-deploy-${license.id}`}
                          >
                            <Server className="h-4 w-4 ml-2" />
                            نشر على السيرفر
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("هل أنت متأكد من حذف هذا الترخيص؟")) {
                              deleteMutation.mutate(license.id);
                            }
                          }}
                          data-testid={`action-delete-${license.id}`}
                        >
                          <Trash2 className="h-4 w-4 ml-2" />
                          حذف
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
            <Key className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-sm">لا توجد تراخيص</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 ml-2" />
              إنشاء ترخيص جديد
            </Button>
          </CardContent>
        </Card>
      )}

      <CreateLicenseDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        servers={serversList || []}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      <LicenseDetailsDialog
        license={showDetails}
        onClose={() => setShowDetails(null)}
        servers={serversList || []}
      />

      <TransferDialog
        license={showTransfer}
        servers={serversList || []}
        onClose={() => setShowTransfer(null)}
        onTransfer={(serverId) => {
          if (showTransfer) {
            transferMutation.mutate({ id: showTransfer.id, serverId });
          }
        }}
        isPending={transferMutation.isPending}
      />
    </div>
  );
}

function CreateLicenseDialog({ open, onOpenChange, servers, onSubmit, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  servers: ServerType[];
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    licenseId: "",
    serverId: "",
    maxUsers: "1000",
    maxSites: "1",
    expiresAt: "",
    clientId: "",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      maxUsers: parseInt(form.maxUsers),
      maxSites: parseInt(form.maxSites),
      expiresAt: new Date(form.expiresAt).toISOString(),
      serverId: form.serverId || null,
      clientId: form.clientId || null,
      notes: form.notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>إنشاء ترخيص جديد</DialogTitle>
          <DialogDescription>أدخل بيانات الترخيص الجديد</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>معرف الترخيص</Label>
            <Input
              value={form.licenseId}
              onChange={(e) => setForm({ ...form, licenseId: e.target.value })}
              placeholder="مثال: LIC-9005"
              required
              data-testid="input-license-id"
            />
          </div>
          <div className="space-y-2">
            <Label>السيرفر</Label>
            <Select value={form.serverId} onValueChange={(v) => setForm({ ...form, serverId: v })}>
              <SelectTrigger data-testid="select-server">
                <SelectValue placeholder="اختر سيرفر (اختياري)" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.host})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الحد الأقصى للمستخدمين</Label>
              <Input
                type="number"
                value={form.maxUsers}
                onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
                required
                data-testid="input-max-users"
              />
            </div>
            <div className="space-y-2">
              <Label>الحد الأقصى للمواقع</Label>
              <Input
                type="number"
                value={form.maxSites}
                onChange={(e) => setForm({ ...form, maxSites: e.target.value })}
                required
                data-testid="input-max-sites"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>تاريخ الانتهاء</Label>
            <Input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              required
              data-testid="input-expires-at"
            />
          </div>
          <div className="space-y-2">
            <Label>معرف العميل (اختياري)</Label>
            <Input
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              placeholder="مثال: CLIENT-001"
              data-testid="input-client-id"
            />
          </div>
          <div className="space-y-2">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="أي ملاحظات إضافية..."
              data-testid="input-notes"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending} data-testid="button-submit-license">
              {isPending ? "جاري الإنشاء..." : "إنشاء الترخيص"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LicenseDetailsDialog({ license, onClose, servers }: {
  license: License | null;
  onClose: () => void;
  servers: ServerType[];
}) {
  if (!license) return null;
  const server = servers.find((s) => s.id === license.serverId);
  const [copied, setCopied] = useState(false);

  const copyHwid = () => {
    if (license.hardwareId) {
      navigator.clipboard.writeText(license.hardwareId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={!!license} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            تفاصيل الترخيص
          </DialogTitle>
          <DialogDescription>معلومات كاملة عن الترخيص</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border divide-y">
            <DetailRow label="معرف الترخيص" value={license.licenseId} />
            <DetailRow
              label="معرف الهاردوير"
              value={
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{license.hardwareId || "غير محدد"}</span>
                  {license.hardwareId && (
                    <Button size="icon" variant="ghost" onClick={copyHwid} className="h-6 w-6">
                      {copied ? <CheckCircle className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  )}
                </div>
              }
            />
            <DetailRow label="الحالة" value={<StatusBadge status={license.status} />} />
            <DetailRow
              label="تاريخ الانتهاء"
              value={new Date(license.expiresAt).toLocaleString("ar-IQ")}
            />
            <DetailRow label="معرف العميل" value={license.clientId || "غير محدد"} />
            <DetailRow
              label="الحد الأقصى للمستخدمين"
              value={<span className="text-emerald-600 dark:text-emerald-400">{license.maxUsers.toLocaleString()}</span>}
            />
            <DetailRow label="الحد الأقصى للمواقع" value={license.maxSites.toString()} />
            <DetailRow
              label="السيرفر"
              value={server ? `${server.name} (${server.host})` : "غير مرتبط"}
            />
          </div>
          {license.notes && (
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground mb-1">ملاحظات</p>
              <p className="text-sm">{license.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function TransferDialog({ license, servers, onClose, onTransfer, isPending }: {
  license: License | null;
  servers: ServerType[];
  onClose: () => void;
  onTransfer: (serverId: string) => void;
  isPending: boolean;
}) {
  const [selectedServer, setSelectedServer] = useState("");

  if (!license) return null;

  const availableServers = servers.filter((s) => s.id !== license.serverId);

  return (
    <Dialog open={!!license} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>نقل الترخيص</DialogTitle>
          <DialogDescription>
            نقل الترخيص {license.licenseId} إلى سيرفر آخر
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>السيرفر الجديد</Label>
            <Select value={selectedServer} onValueChange={setSelectedServer}>
              <SelectTrigger data-testid="select-transfer-server">
                <SelectValue placeholder="اختر السيرفر" />
              </SelectTrigger>
              <SelectContent>
                {availableServers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.host})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            onClick={() => onTransfer(selectedServer)}
            disabled={!selectedServer || isPending}
            data-testid="button-confirm-transfer"
          >
            {isPending ? "جاري النقل..." : "نقل الترخيص"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
