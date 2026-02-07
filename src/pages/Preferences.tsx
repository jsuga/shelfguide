import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Palette } from "lucide-react";
import { useTheme, type GenreTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const themeCards: {
  id: GenreTheme;
  name: string;
  description: string;
  colors: { bg: string; primary: string; accent: string };
  images: [string, string, string];
  detail: string;
}[] = [
  {
    id: "fantasy",
    name: "Fantasy",
    description: "Enchanted forests & golden candlelight",
    colors: {
      bg: "hsl(140,25%,8%)",
      primary: "hsl(42,80%,52%)",
      accent: "hsl(150,30%,16%)",
    },
    images: [
      "/images/themes/fantasy1.jpg",
      "/images/themes/fantasy2.jpg",
      "/images/themes/fantasy3.jpg",
    ],
    detail: "Mossy glades, runes, and torchlit stonework.",
  },
  {
    id: "scifi",
    name: "Science Fiction",
    description: "Deep space & electric cyan light",
    colors: {
      bg: "hsl(225,50%,6%)",
      primary: "hsl(195,90%,50%)",
      accent: "hsl(225,35%,15%)",
    },
    images: [
      "/images/themes/scifi1.jpg",
      "/images/themes/scifi2.jpg",
      "/images/themes/scifi3.jpg",
    ],
    detail: "Neon corridors, holograms, and orbital glow.",
  },
  {
    id: "history",
    name: "History",
    description: "Antique maps & aged parchment",
    colors: {
      bg: "hsl(35,35%,92%)",
      primary: "hsl(30,55%,38%)",
      accent: "hsl(30,25%,82%)",
    },
    images: [
      "/images/themes/history1.jpg",
      "/images/themes/history3.png",
      "/images/themes/history1.jpg",
    ],
    detail: "Cartography lines, vellum texture, and inked edges.",
  },
  {
    id: "romance",
    name: "Romance",
    description: "Soft blush & Parisian elegance",
    colors: {
      bg: "hsl(20,35%,96%)",
      primary: "hsl(345,50%,52%)",
      accent: "hsl(345,25%,88%)",
    },
    images: [
      "/images/themes/romance1.jpg",
      "/images/themes/romance2.jpg",
      "/images/themes/romance3.jpg",
    ],
    detail: "Petals, handwritten notes, and golden hour light.",
  },
  {
    id: "thriller",
    name: "Thriller",
    description: "Dark rooms & blood red accents",
    colors: {
      bg: "hsl(0,0%,5%)",
      primary: "hsl(0,75%,48%)",
      accent: "hsl(0,0%,14%)",
    },
    images: [
      "/images/themes/thriller1.jpg",
      "/images/themes/thriller3.jpg",
      "/images/themes/thriller1.jpg",
    ],
    detail: "Hard shadows, gritty tape, and cold evidence boards.",
  },
];

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" as const },
  transition: { duration: 0.6 },
};

const Preferences = () => {
  const { theme, setTheme } = useTheme();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserEmail(user?.email ?? null);
      const storedUsername = (user?.user_metadata as { username?: string })?.username || "";
      setUsername(storedUsername);
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserEmail(user?.email ?? null);
      const storedUsername = (user?.user_metadata as { username?: string })?.username || "";
      setUsername(storedUsername);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSave = async () => {
    if (!username.trim()) {
      toast.error("Username cannot be empty.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: { username: username.trim() },
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Username updated.");
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">Preferences</h1>
        <p className="text-muted-foreground mt-2 font-body">
          Customize your reading experience
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <h2 className="font-display text-2xl font-bold mb-2">Profile</h2>
          <p className="text-sm text-muted-foreground font-body mb-6">
            Manage your account details and how you appear in the library.
          </p>
          {userEmail ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input value={userEmail} disabled />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="chapterSeeker"
                />
              </div>
              <div className="flex items-center justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground font-body">
              Sign in to manage your username.
            </p>
          )}
        </section>

        <section className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-border/60">
          <Palette className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2">
            More preferences coming soon
          </h2>
          <p className="text-muted-foreground max-w-md font-body">
            Choose your genre theme, manage reading preferences, and review your
            feedback history.
          </p>
        </section>
      </div>

      <section className="py-16">
        <div className="container mx-auto px-0">
          <motion.div {...fadeInUp} className="text-center mb-10">
            <h2 className="font-display text-3xl md:text-4xl font-bold mb-3">
              Choose Your Atmosphere
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto font-body">
              Each genre transforms the entire reading experience
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
            {themeCards.map((t, i) => (
              <motion.div
                key={t.id}
                {...fadeInUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              >
                <button
                  onClick={() => {
                    setTheme(t.id);
                    toast.success(`${t.name} theme applied!`);
                  }}
                  className={`w-full text-left rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.03] ${
                    theme === t.id
                      ? "border-primary shadow-lg ring-2 ring-primary/30"
                      : "border-transparent hover:border-border"
                  }`}
                >
                  <div className="h-28 relative overflow-hidden">
                    <div
                      className="absolute inset-0 bg-cover bg-center"
                      style={{ backgroundImage: `url(${t.images[0]})` }}
                    />
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(145deg, ${t.colors.bg}cc, ${t.colors.accent}99)`,
                      }}
                    />
                    <div className="absolute inset-x-3 top-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/80 font-body">
                      <span className="w-2 h-2 rounded-full" style={{ background: t.colors.primary }} />
                      {t.name}
                    </div>
                    <div className="absolute bottom-3 left-3 flex gap-2">
                      {t.images.map((img, index) => (
                        <div
                          key={`${t.id}-${index}`}
                          className="h-8 w-10 rounded-md border border-white/30 bg-white/10 shadow-lg"
                          style={{ backgroundImage: `url(${img})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="p-3 bg-card">
                    <h3 className="font-display font-bold text-sm">
                      {t.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 font-body">
                      {t.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80 mt-2 font-body">
                      {t.detail}
                    </p>
                  </div>
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};

export default Preferences;
