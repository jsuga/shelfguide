import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import PasswordResetResend from "@/components/auth/PasswordResetResend";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // On mount: try to establish recovery session from URL params
  useEffect(() => {
    let mounted = true;

    const establish = async () => {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

      // PKCE flow: ?code=...
      const code = search.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!mounted) return;
        if (error) {
          setLinkError("This reset link is invalid or expired. Please request a new one.");
          setChecked(true);
          return;
        }
        setSessionReady(true);
        setChecked(true);
        return;
      }

      // Implicit flow: #access_token=...&type=recovery
      const accessToken = hash.get("access_token");
      if (accessToken) {
        // Supabase JS v2 auto-detects hash tokens via onAuthStateChange
        // Wait briefly for the auth listener to pick it up
        await new Promise((r) => setTimeout(r, 500));
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        if (data.session?.user) {
          setSessionReady(true);
        } else {
          setLinkError("This reset link is invalid or expired. Please request a new one.");
        }
        setChecked(true);
        return;
      }

      // Check for error params (e.g., expired OTP link)
      const errorCode =
        hash.get("error_code") || search.get("error_code");
      const errorParam = hash.get("error") || search.get("error");
      const errorDesc =
        hash.get("error_description") || search.get("error_description");

      if (errorCode || errorParam) {
        const desc = errorDesc
          ? errorDesc.replace(/\+/g, " ")
          : "This reset link is invalid or expired.";
        setLinkError(desc);
        setChecked(true);
        return;
      }

      // No params at all — check existing session (e.g., PASSWORD_RECOVERY event)
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session?.user) {
        setSessionReady(true);
      }
      setChecked(true);
    };

    void establish();

    // Also listen for PASSWORD_RECOVERY event
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;
        if (
          (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") &&
          session?.user
        ) {
          setSessionReady(true);
          setLinkError(null);
        }
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const validationMessage = useMemo(() => {
    if (!password && !confirmPassword) return null;
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (confirmPassword && password !== confirmPassword)
      return "Passwords do not match.";
    return null;
  }, [password, confirmPassword]);

  const showResendUI = checked && linkError && !sessionReady;
  const showPasswordForm = checked && sessionReady && !linkError;
  const showLoading = !checked;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionReady || submitting) return;
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

    toast.success("Password updated successfully!");
    setTimeout(() => navigate("/library", { replace: true }), 2000);
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

            {showLoading && (
              <p className="text-sm text-muted-foreground mt-6 font-body">
                Verifying your reset link...
              </p>
            )}

            {showResendUI && (
              <>
                <h1 className="font-display text-3xl font-bold mt-3">
                  Link expired
                </h1>
                <p className="text-sm text-muted-foreground mt-2 font-body">
                  {linkError}
                </p>
                <div className="mt-6">
                  <PasswordResetResend
                    onBackToSignIn={() => navigate("/", { replace: true })}
                    primaryLabel="Send new reset email"
                  />
                </div>
              </>
            )}

            {showPasswordForm && (
              <>
                <h1 className="font-display text-3xl font-bold mt-3">
                  Reset your password
                </h1>
                <p className="text-sm text-muted-foreground mt-2 font-body">
                  Enter a new password for your ShelfGuide account.
                </p>
                <form
                  onSubmit={(e) => void handleSubmit(e)}
                  className="mt-6 grid gap-4"
                >
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
                    <p className="text-xs text-destructive">
                      {validationMessage}
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      submitting || !sessionReady || Boolean(validationMessage)
                    }
                  >
                    {submitting ? "Updating..." : "Update password"}
                  </Button>
                </form>
              </>
            )}

            {checked && !showResendUI && !showPasswordForm && (
              <>
                <h1 className="font-display text-3xl font-bold mt-3">
                  Reset your password
                </h1>
                <p className="text-sm text-muted-foreground mt-2 font-body">
                  Open this page from your password reset email link to
                  continue.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default ResetPassword;
