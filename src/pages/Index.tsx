import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  ArrowRight,
  Upload,
  Library,
  Disc3,
  MessageSquare,
  Cloud,
  Palette,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import type { GenreTheme } from "@/contexts/theme-types";
import { toast } from "sonner";

const themeCards: {
  id: GenreTheme; name: string; description: string;
  colors: { bg: string; primary: string; accent: string };
  images: string[]; detail: string;
}[] = [
  { id: "fantasy", name: "Fantasy", description: "Enchanted forests & golden candlelight", colors: { bg: "hsl(140,25%,8%)", primary: "hsl(42,80%,52%)", accent: "hsl(150,30%,16%)" }, images: ["/images/themes/fantasy1.jpg", "/images/themes/fantasy2.jpg", "/images/themes/fantasy3.jpg", "/images/themes/fantasy4.jpg", "/images/themes/fantasy6.jpg"], detail: "Mossy glades, runes, and torchlit stonework." },
  { id: "scifi", name: "Science Fiction", description: "Deep space & electric cyan light", colors: { bg: "hsl(225,50%,6%)", primary: "hsl(195,90%,50%)", accent: "hsl(225,35%,15%)" }, images: ["/images/themes/scifi1.jpg", "/images/themes/scifi2.jpg", "/images/themes/scifi3.jpg"], detail: "Neon corridors, holograms, and orbital glow." },
  { id: "history", name: "History", description: "Antique maps & aged parchment", colors: { bg: "hsl(35,35%,92%)", primary: "hsl(30,55%,38%)", accent: "hsl(30,25%,82%)" }, images: ["/images/themes/history1.jpg", "/images/themes/history3.png", "/images/themes/history1.jpg"], detail: "Cartography lines, vellum texture, and inked edges." },
  { id: "romance", name: "Romance", description: "Soft blush & Parisian elegance", colors: { bg: "hsl(20,35%,96%)", primary: "hsl(345,50%,52%)", accent: "hsl(345,25%,88%)" }, images: ["/images/themes/romance1.jpg", "/images/themes/romance2.jpg", "/images/themes/romance3.jpg", "/images/themes/romance4.jpg", "/images/themes/romance6.jpg"], detail: "Petals, handwritten notes, and golden hour light." },
  { id: "thriller", name: "Thriller", description: "Dark rooms & blood red accents", colors: { bg: "hsl(0,0%,5%)", primary: "hsl(0,75%,48%)", accent: "hsl(0,0%,14%)" }, images: ["/images/themes/thriller1.jpg", "/images/themes/thriller3.jpg", "/images/themes/thriller1.jpg"], detail: "Hard shadows, gritty tape, and cold evidence boards." },
];

const howItWorksSteps = [
  { icon: Upload, title: "Import Your Books", description: "Upload a Goodreads CSV export or add books manually. We'll enrich them with cover images and metadata." },
  { icon: Library, title: "Manage Your Library", description: "Organize books by status, genre, and series. Search, sort, and track what you've read." },
  { icon: Disc3, title: "Spin the TBR Wheel", description: "Can't decide what to read next? Let the wheel choose from your TBR pile." },
  { icon: MessageSquare, title: "Chat with the AI Copilot", description: "Get personalized recommendations with clear explanations. Accept or reject to refine future suggestions." },
  { icon: Cloud, title: "Sync Across Sessions", description: "Your data follows you. Sign in to sync your library, preferences, and feedback across devices." },
];

const features = [
  { icon: Palette, title: "Genre-Based Theming", description: "Transform the entire interface to match your reading mood - from enchanted forests to noir thrillers." },
  { icon: Sparkles, title: "Transparent AI Reasoning", description: "Every recommendation comes with a clear explanation of why it fits your reading profile." },
  { icon: ThumbsUp, title: "Learns from Feedback", description: "Accept or reject suggestions and watch the AI adapt to your unique preferences over time." },
];

const fadeInUp = { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" as const }, transition: { duration: 0.6 } };

const Index = () => {
  const { theme, setTheme } = useTheme();
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const getThemeFallback = (_themeId: GenreTheme) => "/images/themes/shelf1.jpg";
  const getImageSrc = (themeId: GenreTheme, src: string) => failedImages[src] ? getThemeFallback(themeId) : src;
  const onImageError = (src: string) => { setFailedImages((prev) => (prev[src] ? prev : { ...prev, [src]: true })); };

  return (
    <main className="pt-16">
      {/* Hero */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 theme-hero-image" />
          <div className="absolute inset-0 theme-hero-vignette" />
          <motion.div className="absolute top-20 left-[10%] w-72 h-72 rounded-full bg-primary/10 blur-3xl" animate={{ y: [0, -20, 0], scale: [1, 1.1, 1] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div className="absolute bottom-20 right-[10%] w-96 h-96 rounded-full bg-primary/5 blur-3xl" animate={{ y: [0, 20, 0], scale: [1, 1.05, 1] }} transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }} />
        </div>
        <div className="container relative z-10 mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-8 text-sm font-body font-medium">
              <BookOpen className="w-4 h-4" />AI-Powered Book Discovery
            </div>
            <p className="text-sm md:text-base font-body uppercase tracking-[0.25em] text-primary/70 mb-4">ShelfGuide — Because choosing is the hardest part.</p>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6">
              How It<br /><span className="text-primary">Works</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 font-body">
              Build your personal library, chat with an intelligent copilot, and discover your next great read — with recommendations that actually understand you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="text-lg px-8 h-12"><Link to="/copilot">Start Reading <ArrowRight className="ml-2 w-5 h-5" /></Link></Button>
              <Button asChild variant="outline" size="lg" className="text-lg px-8 h-12"><a href="#steps">See the Steps</a></Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How It Works Steps */}
      <section id="steps" className="py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto font-body">Five simple steps to your next favorite book</p>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-6xl mx-auto">
            {howItWorksSteps.map((step, i) => (
              <motion.div key={step.title} {...fadeInUp} transition={{ duration: 0.6, delay: i * 0.1 }}>
                <Card className="text-center h-full border-border/50 bg-card/80 backdrop-blur-sm hover:shadow-lg transition-shadow">
                  <CardContent className="pt-8 pb-6 px-4">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <step.icon className="w-7 h-7 text-primary" />
                    </div>
                    <div className="text-xs font-bold text-primary/60 mb-2 font-body uppercase tracking-widest">Step {i + 1}</div>
                    <h3 className="font-display text-lg font-bold mb-2">{step.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed font-body">{step.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <motion.div {...fadeInUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">Why ShelfGuide?</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto font-body">Powered by AI that explains itself</p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {features.map((feat, i) => (
              <motion.div key={feat.title} {...fadeInUp} transition={{ duration: 0.6, delay: i * 0.15 }}>
                <Card className="h-full border-border/50 hover:shadow-lg transition-shadow">
                  <CardContent className="pt-8 pb-6 px-6">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-5"><feat.icon className="w-6 h-6 text-primary" /></div>
                    <h3 className="font-display text-xl font-bold mb-3">{feat.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed font-body">{feat.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Genre Gallery */}
      <section className="py-24 bg-secondary/20">
        <div className="container mx-auto px-4">
          <motion.div {...fadeInUp} className="text-center mb-14">
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">Explore Genre Atmospheres</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto font-body">Preview the visual mood for each genre and apply it instantly.</p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
            {themeCards.map((card, i) => (
              <motion.div key={card.id} {...fadeInUp} transition={{ duration: 0.5, delay: i * 0.08 }}>
                <button onClick={() => { setTheme(card.id); toast.success(`${card.name} theme applied!`); }}
                  className={`w-full text-left rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.03] ${theme === card.id ? "border-primary shadow-lg ring-2 ring-primary/30" : "border-transparent hover:border-border"}`}>
                  <div className="h-32 relative overflow-hidden">
                    <img src={getImageSrc(card.id, card.images[0] || getThemeFallback(card.id))} onError={() => onImageError(card.images[0] || "")} alt={`${card.name} theme preview`} className="absolute inset-0 h-full w-full object-cover" />
                    <div className="absolute inset-0" style={{ background: `linear-gradient(145deg, ${card.colors.bg}cc, ${card.colors.accent}99)` }} />
                    <div className="absolute inset-x-3 top-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/85 font-body">
                      <span className="w-2 h-2 rounded-full" style={{ background: card.colors.primary }} />{card.name}
                    </div>
                    <div className="absolute bottom-3 left-3 right-3 grid grid-cols-4 gap-2">
                      {card.images.slice(0, 4).map((img) => (
                        <div key={`${card.id}-${img}`} className="h-8 rounded-md border border-white/30 bg-white/10 shadow-lg overflow-hidden">
                          <img src={getImageSrc(card.id, img)} onError={() => onImageError(img)} alt="" className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-3 bg-card">
                    <h3 className="font-display font-bold text-sm">{card.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 font-body">{card.description}</p>
                    <p className="text-[11px] text-muted-foreground/80 mt-2 font-body">{card.detail}</p>
                  </div>
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24">
        <div className="container mx-auto px-4 text-center">
          <motion.div {...fadeInUp}>
            <h2 className="font-display text-3xl md:text-5xl font-bold mb-6">Ready to Find Your Next Great Read?</h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-10 font-body">Start building your library and let the AI do the hard part.</p>
            <Button asChild size="lg" className="text-lg px-10 h-14"><Link to="/library">Get Started <ArrowRight className="ml-2 w-5 h-5" /></Link></Button>
          </motion.div>
        </div>
      </section>
    </main>
  );
};

export default Index;
