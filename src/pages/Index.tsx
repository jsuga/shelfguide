import { motion } from "framer-motion";
import {
  BookOpen,
  ArrowRight,
  MessageSquare,
  Sparkles,
  Palette,
  ThumbsUp,
  BookMarked,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { useTheme, type GenreTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";

/* ── Static data ── */

const themeCards: {
  id: GenreTheme;
  name: string;
  description: string;
  colors: { bg: string; primary: string; accent: string };
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
  },
];

const steps = [
  {
    icon: BookMarked,
    title: "Build Your Library",
    description:
      "Add your favorite books and track what you're reading, want to read, or have finished.",
  },
  {
    icon: MessageSquare,
    title: "Chat with Your Copilot",
    description:
      'Ask natural questions like "What should I read next?" and get thoughtful answers.',
  },
  {
    icon: Sparkles,
    title: "Discover & Decide",
    description:
      "Get personalized picks with clear explanations. Accept or reject to refine future suggestions.",
  },
];

const features = [
  {
    icon: Palette,
    title: "Genre-Based Theming",
    description:
      "Transform the entire interface to match your reading mood — from enchanted forests to noir thrillers.",
  },
  {
    icon: Sparkles,
    title: "Transparent AI Reasoning",
    description:
      "Every recommendation comes with a clear explanation of why it fits your reading profile.",
  },
  {
    icon: ThumbsUp,
    title: "Learns from Feedback",
    description:
      "Accept or reject suggestions and watch the AI adapt to your unique preferences over time.",
  },
];

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" as const },
  transition: { duration: 0.6 },
};

/* ── Page ── */

const Index = () => {
  const { theme, setTheme } = useTheme();

  return (
    <main className="pt-16">
      {/* ═══ Hero ═══ */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute top-20 left-[10%] w-72 h-72 rounded-full bg-primary/10 blur-3xl"
            animate={{ y: [0, -20, 0], scale: [1, 1.1, 1] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-20 right-[10%] w-96 h-96 rounded-full bg-primary/5 blur-3xl"
            animate={{ y: [0, 20, 0], scale: [1, 1.05, 1] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="container relative z-10 mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-8 text-sm font-body font-medium">
              <BookOpen className="w-4 h-4" />
              AI-Powered Book Discovery
            </div>

            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6">
              Your AI Reading
              <br />
              <span className="text-primary">Companion</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 font-body">
              Build your personal library, chat with an intelligent copilot, and
              discover your next great read — with recommendations that actually
              understand you.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="text-lg px-8 h-12">
                <Link to="/copilot">
                  Start Reading <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="text-lg px-8 h-12"
              >
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ How It Works ═══ */}
      <section id="how-it-works" className="py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto font-body">
              Three simple steps to your next favorite book
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                {...fadeInUp}
                transition={{ duration: 0.6, delay: i * 0.15 }}
              >
                <Card className="text-center h-full border-border/50 bg-card/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                  <CardContent className="pt-8 pb-6 px-6">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                      <step.icon className="w-7 h-7 text-primary" />
                    </div>
                    <div className="text-xs font-bold text-primary/60 mb-2 font-body uppercase tracking-widest">
                      Step {i + 1}
                    </div>
                    <h3 className="font-display text-xl font-bold mb-3">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed font-body">
                      {step.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
              Why Reading Copilot?
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto font-body">
              Powered by AI that explains itself
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                {...fadeInUp}
                transition={{ duration: 0.6, delay: i * 0.15 }}
              >
                <Card className="h-full border-border/50 hover:shadow-lg transition-shadow">
                  <CardContent className="pt-8 pb-6 px-6">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-5">
                      <feat.icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="font-display text-xl font-bold mb-3">
                      {feat.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed font-body">
                      {feat.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Theme Showcase ═══ */}
      <section className="py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
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
                  {/* Color preview bar */}
                  <div
                    className="h-24 relative"
                    style={{
                      background: `linear-gradient(135deg, ${t.colors.bg}, ${t.colors.accent})`,
                    }}
                  >
                    <div
                      className="absolute bottom-2 right-2 w-8 h-8 rounded-full shadow-md"
                      style={{ background: t.colors.primary }}
                    />
                  </div>
                  <div className="p-3 bg-card">
                    <h3 className="font-display font-bold text-sm">
                      {t.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 font-body">
                      {t.description}
                    </p>
                  </div>
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Final CTA ═══ */}
      <section className="py-24">
        <div className="container mx-auto px-4 text-center">
          <motion.div {...fadeInUp}>
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-6">
              Ready to Find Your Next Great Read?
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10 font-body">
              Start building your library and let the AI do the hard part.
            </p>
            <Button asChild size="lg" className="text-lg px-10 h-14">
              <Link to="/library">
                Get Started <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="py-8 border-t border-border/50">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground font-body">
          <p>
            Reading Copilot — AI-powered book recommendations. Built with love
            for readers.
          </p>
        </div>
      </footer>
    </main>
  );
};

export default Index;
