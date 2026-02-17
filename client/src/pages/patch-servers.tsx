import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Server,
  Globe,
  Hash,
  User,
  Terminal,
  Wifi,
  MonitorSmartphone,
} from "lucide-react";
import type { PatchToken } from "@shared/schema";

export default function PatchServers() {
  const { data: patchServers, isLoading } = useQuery<PatchToken[]>({
    queryKey: ["/api/patches/available"],
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
                      {patch.hardwareId ? patch.hardwareId.substring(0, 16) + "..." : "غير محدد"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t">
                  <Badge
                    variant="outline"
                    className="bg-amber-500/15 text-amber-600 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate"
                    data-testid={`status-patch-${patch.id}`}
                  >
                    <Wifi className="h-3 w-3 ml-1" />
                    بانتظار الترخيص
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
    </div>
  );
}
