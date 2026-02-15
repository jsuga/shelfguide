import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSessionReady(Boolean(data.session?.user));
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setSessionReady(Boolean(session?.user));
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const validationMessage = useMemo(() => {
    if (!password && !confirmPassword) return null;
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (confirmPassword && password !== confirmPassword) return "Passwords do not match.";
    return null;
  }, [password, confirmPassword]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionReady) {
      toast.error("Recovery link is invalid or expired. Request a new reset email.");
      return;
    }
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      toast.error(`Could not reset password: ${error.message}`);
      return;
    }

    toast.success("Password reset successful.");
    navigate("/library", { replace: true });
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mx-auto max-w-xl">
        <Card className="border-border/60 bg-card/80">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
              <LockKeyhole className="h-4 w-4" />
              Account recovery
            </div>
            <h1 className="font-display text-3xl font-bold mt-3">Reset your password</h1>
            <p className="text-sm text-muted-foreground mt-2 font-body">
              Enter a new password for your ShelfGuide account.
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                />
              </div>

              {validationMessage && (
                <p className="text-xs text-destructive">{validationMessage}</p>
              )}

              {!sessionReady && (
                <p className="text-xs text-muted-foreground">
                  Open this page from your password reset email link to continue.
                </p>
              )}

              <Button type="submit" disabled={submitting || !sessionReady || Boolean(validationMessage)}>
                {submitting ? "Updating..." : "Update password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default ResetPassword;
