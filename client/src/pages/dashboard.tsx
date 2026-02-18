import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Key, Server, CheckCircle, AlertTriangle, Clock, Users } from "lucide-react";
import type { License, Server as ServerType, ActivityLog } from "@shared/schema";

function StatCard({ title, value, icon: Icon, description, loading }: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  loading?: boolean;
}) {
  return (
    <Card data-testid={`card-stat-${title}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    active: { label: "نشط", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 no-default-hover-elevate no-default-active-elevate" },
    inactive: { label: "غير نشط", className: "bg-muted text-muted-foreground no-default-hover-elevate no-default-active-elevate" },
    disabled: { label: "معطل", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate" },
    suspended: { label: "موقوف", className: "bg-red-500/15 text-red-600 dark:text-red-400 no-default-hover-elevate no-default-active-elevate" },
    expired: { label: "منتهي", className: "bg-red-500/15 text-red-600 dark:text-red-400 no-default-hover-elevate no-default-active-elevate" },
  };
  const v = variants[status] || variants.inactive;
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}

export default function Dashboard() {
  const { data: licenses, isLoading: licensesLoading } = useQuery<License[]>({
    queryKey: ["/api/licenses"],
  });

  const { data: serversList, isLoading: serversLoading } = useQuery<ServerType[]>({
    queryKey: ["/api/servers"],
  });

  const { data: logs, isLoading: logsLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/activity-logs"],
  });

  const activeLicenses = licenses?.filter((l) => l.status === "active").length || 0;
  const connectedServers = serversList?.filter((s) => s.isConnected).length || 0;
  const expiringSoon = licenses?.filter((l) => {
    const exp = new Date(l.expiresAt);
    const now = new Date();
    const diff = exp.getTime() - now.getTime();
    return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
  }).length || 0;

  const loading = licensesLoading || serversLoading;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">لوحة التحكم</h1>
        <p className="text-muted-foreground text-sm mt-1">نظرة عامة على التراخيص والسيرفرات</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي التراخيص"
          value={licenses?.length || 0}
          icon={Key}
          description="جميع التراخيص المسجلة"
          loading={loading}
        />
        <StatCard
          title="التراخيص النشطة"
          value={activeLicenses}
          icon={CheckCircle}
          description="تراخيص تعمل حالياً"
          loading={loading}
        />
        <StatCard
          title="السيرفرات المتصلة"
          value={`${connectedServers} / ${serversList?.length || 0}`}
          icon={Server}
          description="السيرفرات المتصلة حالياً"
          loading={loading}
        />
        <StatCard
          title="تنتهي قريباً"
          value={expiringSoon}
          icon={AlertTriangle}
          description="خلال 7 أيام"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base font-semibold">أحدث التراخيص</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {licensesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : licenses && licenses.length > 0 ? (
              <div className="space-y-3">
                {licenses.slice(0, 5).map((license) => (
                  <div
                    key={license.id}
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                    data-testid={`row-license-${license.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
                        <Key className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{license.licenseId}</p>
                        <p className="text-xs text-muted-foreground">
                          <Users className="inline h-3 w-3 ml-1" />
                          {license.maxUsers.toLocaleString()} مستخدم
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={license.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                لا توجد تراخيص بعد
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base font-semibold">آخر النشاطات</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="space-y-2">
                {logs.slice(0, 6).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 rounded-md p-2.5 text-sm"
                    data-testid={`row-activity-${log.id}`}
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 mt-0.5 flex-shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{log.action}</p>
                      {log.details && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.details}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("ar-IQ") : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                لا توجد نشاطات بعد
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ScrollText(props: { className?: string }) {
  return <Clock {...props} />;
}
