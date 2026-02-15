import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Menu, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/contexts/ThemeContext";
import type { GenreTheme } from "@/contexts/theme-types";
import { themeOptions } from "@/contexts/theme-types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PasswordResetResend from "@/components/auth/PasswordResetResend";

const navLinks = [
  { path: "/", label: "How it Works" },
  { path: "/library", label: "My Library" },
  { path: "/tbr-wheel", label: "TBR Wheel" },
  { path: "/copilot", label: "Copilot" },
  { path: "/community", label: "Community" },
  { path: "/preferences", label: "Settings" },
];

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_up");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [showResetPanel, setShowResetPanel] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setIsAuthenticated(Boolean(data.session?.user));
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(Boolean(session?.user));
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authOpen) setShowResetPanel(false);
  }, [authOpen]);

  useEffect(() => {
    if (authMode !== "sign_in") setShowResetPanel(false);
  }, [authMode]);

  const handleAuth = async () => {
    if (!authEmail || !authPassword) {
      toast.error("Enter an email and password.");
      return;
    }
    if (authMode === "sign_up") {
      if (!authUsername.trim()) {
        toast.error("Enter a username.");
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
        options: {
          data: { username: authUsername.trim() },
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Account created. Check your email to confirm.");
      setAuthOpen(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Signed in.");
    setAuthOpen(false);
    navigate("/library", { replace: false });
  };


  const handleHeaderAuthClick = async () => {
    if (isAuthenticated) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Signed out.");
      return;
    }
    setAuthOpen(true);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <nav className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-xl font-bold tracking-tight"
        >
          <BookOpen className="w-6 h-6 text-primary" />
          <span>ShelfGuide</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Button
              key={link.path}
              asChild
              variant={location.pathname === link.path ? "secondary" : "ghost"}
              size="sm"
            >
              <Link to={link.path}>{link.label}</Link>
            </Button>
          ))}
          <div className="ml-2 w-44">
            <Select value={theme} onValueChange={(value) => setTheme(value as GenreTheme)}>
              <SelectTrigger className="h-9">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Theme" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {themeOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" className="ml-2" onClick={() => void handleHeaderAuthClick()}>
            {isAuthenticated ? "Sign out" : "Sign in"}
          </Button>
        </div>

        {/* Mobile menu */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-64">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-display">
                <BookOpen className="w-5 h-5 text-primary" />
                Navigation
              </SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 mt-6">
              {navLinks.map((link) => (
                <Button
                  key={link.path}
                  asChild
                  variant={location.pathname === link.path ? "secondary" : "ghost"}
                  className="justify-start"
                  onClick={() => setOpen(false)}
                >
                  <Link to={link.path}>{link.label}</Link>
                </Button>
              ))}
              <Button
                variant="outline"
                className="justify-start mt-2"
                onClick={() => {
                  setOpen(false);
                  void handleHeaderAuthClick();
                }}
              >
                {isAuthenticated ? "Sign out" : "Sign in"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </nav>

      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="max-w-lg border border-border/60 bg-card/95 p-0">
          <div className="rounded-2xl overflow-hidden">
            <div className="px-8 py-6 bg-secondary/40 border-b border-border/60">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">
                  Save Your Library
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground font-body mt-2">
                Create an account to sync your books across devices.
              </p>
            </div>

            <div className="px-8 py-6 grid gap-4">
              <div className="flex items-center gap-2">
                <Button
                  variant={authMode === "sign_up" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAuthMode("sign_up")}
                >
                  Create account
                </Button>
                <Button
                  variant={authMode === "sign_in" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAuthMode("sign_in")}
                >
                  Sign in
                </Button>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="reader@example.com"
                />
              </div>

              {authMode === "sign_up" && (
                <div className="grid gap-2">
                  <Label htmlFor="auth-username">Username</Label>
                  <Input
                    id="auth-username"
                    value={authUsername}
                    onChange={(event) => setAuthUsername(event.target.value)}
                    placeholder="chapterSeeker"
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
                {authMode === "sign_in" && !showResetPanel && (
                  <button
                    type="button"
                    onClick={() => setShowResetPanel(true)}
                    className="text-left text-xs text-primary hover:text-primary/80 disabled:text-muted-foreground"
                  >
                    Forgot password?
                  </button>
                )}
              </div>

              {authMode === "sign_in" && showResetPanel && (
                <div className="rounded-lg border border-border/60 bg-background/70 p-4">
                  <PasswordResetResend
                    defaultEmail={authEmail}
                    onBackToSignIn={() => setShowResetPanel(false)}
                    backToSignInLabel="Back to sign in"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setAuthOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAuth}>
                  {authMode === "sign_up" ? "Create account" : "Sign in"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
};

export default Navbar;
