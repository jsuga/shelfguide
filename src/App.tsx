import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Navbar from "@/components/Navbar";
import SyncBanner from "@/components/SyncBanner";
import { supabase } from "@/integrations/supabase/client";
import Index from "./pages/Index";
import Library from "./pages/Library";
import Copilot from "./pages/Copilot";
import Preferences from "./pages/Preferences";
import TbrWheel from "./pages/TbrWheel";
import Community from "./pages/Community";
import PublicProfile from "./pages/PublicProfile";
import Friends from "./pages/Friends";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AuthAwareHomeRoute = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

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

  if (isAuthenticated) {
    return <Navigate to="/library" replace />;
  }
  return <Index />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Navbar />
          <SyncBanner />
          <div className="theme-page min-h-screen flex flex-col">
            <div className="flex-1">
              <Routes>
                <Route path="/" element={<AuthAwareHomeRoute />} />
                <Route path="/library" element={<Library />} />
                <Route path="/copilot" element={<Copilot />} />
                <Route path="/tbr-wheel" element={<TbrWheel />} />
                <Route path="/preferences" element={<Preferences />} />
                <Route path="/community" element={<Community />} />
                <Route path="/u/:username" element={<PublicProfile />} />
                <Route path="/friends" element={<Friends />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
            <footer className="py-8 border-t border-border/50">
              <div className="container mx-auto px-4 text-center text-sm text-muted-foreground font-body">
                <p>
                  ShelfGuide - AI-powered book recommendations. Built with love for
                  readers.
                </p>
              </div>
            </footer>
          </div>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
