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
  Plus,
  MoreVertical,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Edit,
  Terminal,
  Globe,
  Hash,
  User,
} from "lucide-react";
import type { Server as ServerType } from "@shared/schema";

export default function Servers() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editServer, setEditServer] = useState<ServerType | null>(null);

  const { data: servers, isLoading } = useQuery<ServerType[]>({
    queryKey: ["/api/servers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/servers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setShowCreate(false);
      toast({ title: "تم إضافة السيرفر بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest("PATCH", `/api/servers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      setEditServer(null);
      toast({ title: "تم تحديث السيرفر" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/servers/${id}/test`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/servers"] });
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/servers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-logs"] });
      toast({ title: "تم حذف السيرفر" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-servers-title">السيرفرات</h1>
          <p className="text-muted-foreground text-sm mt-1">إدارة السيرفرات المتصلة عبر SSH</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-add-server">
          <Plus className="h-4 w-4 ml-2" />
          إضافة سيرفر
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : servers && servers.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <Card
              key={server.id}
              className="hover-elevate transition-all"
              data-testid={`card-server-${server.id}`}
            >
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 flex-shrink-0">
                      <Server className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{server.name}</h3>
                      <p className="text-xs text-muted-foreground font-mono">{server.host}</p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-server-actions-${server.id}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => testConnectionMutation.mutate(server.id)}
                        data-testid={`action-test-${server.id}`}
                      >
                        <RefreshCw className="h-4 w-4 ml-2" />
                        اختبار الاتصال
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setEditServer(server)}
                        data-testid={`action-edit-${server.id}`}
                      >
                        <Edit className="h-4 w-4 ml-2" />
                        تعديل
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("هل أنت متأكد من حذف هذا السيرفر؟")) {
                            deleteMutation.mutate(server.id);
                          }
                        }}
                        data-testid={`action-delete-${server.id}`}
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
                    <span className="font-mono">{server.port}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <User className="h-3 w-3" /> المستخدم
                    </span>
                    <span className="font-mono">{server.username}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Terminal className="h-3 w-3" /> Hardware ID
                    </span>
                    <span className="font-mono text-xs truncate max-w-[120px]">
                      {server.hardwareId || "غير محدد"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t">
                  <Badge
                    variant="outline"
                    className={
                      server.isConnected
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate"
                        : "bg-red-500/15 text-red-600 dark:text-red-400 no-default-hover-elevate no-default-active-elevate"
                    }
                  >
                    {server.isConnected ? (
                      <>
                        <Wifi className="h-3 w-3 ml-1" /> متصل
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-3 w-3 ml-1" /> غير متصل
                      </>
                    )}
                  </Badge>
                  {server.lastChecked && (
                    <span className="text-xs text-muted-foreground">
                      آخر فحص: {new Date(server.lastChecked).toLocaleTimeString("ar-IQ")}
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
            <Server className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-sm">لا توجد سيرفرات</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 ml-2" />
              إضافة سيرفر جديد
            </Button>
          </CardContent>
        </Card>
      )}

      <ServerFormDialog
        open={showCreate || !!editServer}
        onOpenChange={(v) => {
          if (!v) {
            setShowCreate(false);
            setEditServer(null);
          }
        }}
        server={editServer}
        onSubmit={(data) => {
          if (editServer) {
            updateMutation.mutate({ id: editServer.id, ...data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function ServerFormDialog({ open, onOpenChange, server, onSubmit, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  server: ServerType | null;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: server?.name || "",
    host: server?.host || "",
    port: server?.port?.toString() || "22",
    username: server?.username || "",
    password: "",
  });

  const handleOpen = (v: boolean) => {
    if (v && server) {
      setForm({
        name: server.name,
        host: server.host,
        port: server.port.toString(),
        username: server.username,
        password: "",
      });
    } else if (v) {
      setForm({ name: "", host: "", port: "22", username: "", password: "" });
    }
    onOpenChange(v);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      name: form.name,
      host: form.host,
      port: parseInt(form.port),
      username: form.username,
    };
    if (form.password) {
      data.password = form.password;
    }
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>{server ? "تعديل السيرفر" : "إضافة سيرفر جديد"}</DialogTitle>
          <DialogDescription>أدخل بيانات الاتصال بالسيرفر عبر SSH</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>اسم السيرفر</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="مثال: سيرفر الإنتاج"
              required
              data-testid="input-server-name"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label>عنوان IP</Label>
              <Input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="192.168.1.100"
                required
                data-testid="input-server-host"
              />
            </div>
            <div className="space-y-2">
              <Label>البورت</Label>
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                required
                data-testid="input-server-port"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>اسم المستخدم</Label>
            <Input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="root"
              required
              data-testid="input-server-username"
            />
          </div>
          <div className="space-y-2">
            <Label>{server ? "كلمة المرور (اتركها فارغة لعدم التغيير)" : "كلمة المرور"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={server ? "اتركها فارغة لعدم التغيير" : "********"}
              required={!server}
              data-testid="input-server-password"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending} data-testid="button-submit-server">
              {isPending ? "جاري الحفظ..." : server ? "حفظ التعديلات" : "إضافة السيرفر"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
