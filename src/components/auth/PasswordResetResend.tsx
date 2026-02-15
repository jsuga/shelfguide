import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const COOLDOWN_SECONDS = 30;

type PasswordResetResendProps = {
  defaultEmail?: string;
  onBackToSignIn?: () => void;
  backToSignInLabel?: string;
  primaryLabel?: string;
  className?: string;
};

const PasswordResetResend = ({
  defaultEmail,
  onBackToSignIn,
  backToSignInLabel = "Back to sign in",
  primaryLabel = "Send reset email",
  className,
}: PasswordResetResendProps) => {
  const [email, setEmail] = useState(defaultEmail || "");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(defaultEmail || "");
  }, [defaultEmail]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const sendReset = async () => {
    if (!email.trim()) {
      toast.error("Enter your email to receive a reset link.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    setDevError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      setMessage("Couldn't send email, please try again.");
      const detail = [error.code, error.message].filter(Boolean).join(" - ");
      setDevError(detail || null);
      toast.error("Couldn't send email, please try again.");
      return;
    }
    setCooldown(COOLDOWN_SECONDS);
    setMessage("If an account exists for that email, a new reset link has been sent.");
    toast.success("If an account exists for that email, a new reset link has been sent.");
  };

  return (
    <div className={className}>
      <div className="grid gap-2">
        <Label htmlFor="recovery-email">Email</Label>
        <Input
          id="recovery-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.com"
          autoComplete="email"
        />
      </div>

      {message && (
        <p className="text-xs text-muted-foreground mt-2">{message}</p>
      )}
      {devError && import.meta.env.DEV && (
        <p className="text-[11px] text-muted-foreground mt-1">Debug: {devError}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void sendReset()} disabled={submitting}>
          {submitting ? "Sending..." : primaryLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void sendReset()}
          disabled={submitting || cooldown > 0}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend"}
        </Button>
        {onBackToSignIn && (
          <Button type="button" variant="ghost" onClick={onBackToSignIn}>
            {backToSignInLabel}
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border/60 bg-background/70 p-3 text-xs text-muted-foreground space-y-1">
        <div>Use the newest email link.</div>
        <div>Check spam/promotions.</div>
        <div>Links expire and can only be used once.</div>
      </div>
    </div>
  );
};

export default PasswordResetResend;
