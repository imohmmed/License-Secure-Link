import { LayoutDashboard, Key, Server, ScrollText, Shield, Settings, LogOut, Package, MonitorSmartphone } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const menuItems = [
  { title: "لوحة التحكم", url: "/", icon: LayoutDashboard },
  { title: "التراخيص", url: "/licenses", icon: Key },
  { title: "السيرفرات", url: "/servers", icon: Server },
  { title: "سيرفرات باتشات", url: "/patch-servers", icon: MonitorSmartphone },
  { title: "الباتشات", url: "/patches", icon: Package },
  { title: "سجل النشاط", url: "/activity", icon: ScrollText },
  { title: "الإعدادات", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { data: user } = useQuery<{ id: string; username: string } | null>({
    queryKey: ["/api/auth/me"],
    staleTime: Infinity,
  });

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
    queryClient.setQueryData(["/api/auth/me"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };

  return (
    <Sidebar side="right">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">License Manager</span>
            <span className="text-xs text-muted-foreground">نظام إدارة التراخيص</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>القائمة الرئيسية</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={`link-nav-${item.url.replace("/", "") || "dashboard"}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-2">
        {user && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground truncate">{user.username}</span>
            <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="text-xs text-muted-foreground text-center">
          v1.0.0 - Secure License System
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
