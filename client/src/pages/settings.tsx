import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings, Key, User, Download, Upload, Eye, EyeOff } from "lucide-react";

export default function SettingsPage() {
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [changingUsername, setChangingUsername] = useState(false);

  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
      toast({ title: "تم تغيير كلمة المرور بنجاح" });
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: any) {
      toast({
        title: "فشل تغيير كلمة المرور",
        description: err.message?.includes("401") ? "كلمة المرور الحالية غير صحيحة" : "حدث خطأ",
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingUsername(true);
    try {
      await apiRequest("POST", "/api/auth/change-username", { newUsername, password: usernamePassword });
      toast({ title: "تم تغيير اسم المستخدم بنجاح" });
      setNewUsername("");
      setUsernamePassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch (err: any) {
      toast({
        title: "فشل تغيير اسم المستخدم",
        description: err.message?.includes("401") ? "كلمة المرور غير صحيحة" : "حدث خطأ",
        variant: "destructive",
      });
    } finally {
      setChangingUsername(false);
    }
  };

  const handleExport = () => {
    window.open("/api/backup/export", "_blank");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await apiRequest("POST", "/api/backup/import", data);
      const result = await res.json();
      toast({
        title: "تم استيراد النسخة الاحتياطية",
        description: `${result.importedServers} سيرفر، ${result.importedLicenses} ترخيص`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/servers"] });
    } catch (err: any) {
      toast({
        title: "فشل الاستيراد",
        description: "تأكد من صحة ملف النسخة الاحتياطية",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto" dir="rtl">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">الإعدادات</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            تغيير اسم المستخدم
          </CardTitle>
          <CardDescription>تغيير اسم المستخدم للدخول إلى لوحة التحكم</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangeUsername} className="space-y-4">
            <div className="space-y-2">
              <Label>اسم المستخدم الجديد</Label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                data-testid="input-new-username"
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور الحالية (للتأكيد)</Label>
              <Input
                type="password"
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                required
                data-testid="input-username-confirm-password"
              />
            </div>
            <Button type="submit" disabled={changingUsername} data-testid="button-change-username">
              {changingUsername ? "جاري التغيير..." : "تغيير اسم المستخدم"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="h-5 w-5" />
            تغيير كلمة المرور
          </CardTitle>
          <CardDescription>تغيير كلمة المرور للدخول إلى لوحة التحكم</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label>كلمة المرور الحالية</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  data-testid="input-current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShowCurrent(!showCurrent)}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={4}
                  data-testid="input-new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShowNew(!showNew)}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button type="submit" disabled={changingPassword} data-testid="button-change-password">
              {changingPassword ? "جاري التغيير..." : "تغيير كلمة المرور"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5" />
            النسخ الاحتياطي
          </CardTitle>
          <CardDescription>تصدير واستيراد بيانات السيرفرات والتراخيص</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleExport} variant="outline" data-testid="button-export-backup">
              <Download className="h-4 w-4 ml-2" />
              تصدير نسخة احتياطية
            </Button>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
                data-testid="input-import-file"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                disabled={importing}
                data-testid="button-import-backup"
              >
                <Upload className="h-4 w-4 ml-2" />
                {importing ? "جاري الاستيراد..." : "استيراد نسخة احتياطية"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            الاستيراد لا يحذف البيانات الحالية - فقط يضيف السيرفرات والتراخيص غير الموجودة
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
