import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText, Key, Server, Shield, Clock, ArrowRightLeft, Play, Pause, Trash2, RefreshCw, Plus } from "lucide-react";
import type { ActivityLog } from "@shared/schema";

const actionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  create_license: Plus,
  activate_license: Play,
  suspend_license: Pause,
  delete_license: Trash2,
  extend_license: RefreshCw,
  transfer_license: ArrowRightLeft,
  deploy_license: Server,
  create_server: Plus,
  delete_server: Trash2,
  test_connection: Shield,
  update_server: RefreshCw,
};

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    create_license: "إنشاء ترخيص",
    activate_license: "تفعيل ترخيص",
    suspend_license: "إيقاف ترخيص",
    expire_license: "انتهاء ترخيص",
    delete_license: "حذف ترخيص",
    extend_license: "تمديد ترخيص",
    transfer_license: "نقل ترخيص",
    deploy_license: "نشر ترخيص",
    create_server: "إضافة سيرفر",
    delete_server: "حذف سيرفر",
    update_server: "تعديل سيرفر",
    test_connection: "اختبار اتصال",
  };
  return labels[action] || action;
}

function getActionColor(action: string) {
  if (action.includes("delete") || action.includes("suspend")) return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (action.includes("create") || action.includes("activate")) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (action.includes("transfer") || action.includes("deploy")) return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
}

export default function Activity() {
  const { data: logs, isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/activity-logs"],
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-activity-title">سجل النشاط</h1>
        <p className="text-muted-foreground text-sm mt-1">جميع العمليات التي تمت على النظام</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base font-semibold">النشاطات</CardTitle>
          <ScrollText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="space-y-2">
              {logs.map((log) => {
                const IconComponent = actionIcons[log.action] || Clock;
                const colorClass = getActionColor(log.action);

                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                    data-testid={`row-log-${log.id}`}
                  >
                    <div className={`flex items-center justify-center w-8 h-8 rounded-md flex-shrink-0 ${colorClass}`}>
                      <IconComponent className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-xs no-default-hover-elevate no-default-active-elevate ${colorClass}`}>
                          {getActionLabel(log.action)}
                        </Badge>
                      </div>
                      {log.details && (
                        <p className="text-sm text-muted-foreground mt-1">{log.details}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("ar-IQ") : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <ScrollText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد نشاطات مسجلة</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
