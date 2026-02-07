import { Palette } from "lucide-react";

const Preferences = () => (
  <main className="container mx-auto px-4 pt-24 pb-16">
    <div className="mb-8">
      <h1 className="font-display text-4xl font-bold">Preferences</h1>
      <p className="text-muted-foreground mt-2 font-body">
        Customize your reading experience
      </p>
    </div>

    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Palette className="w-16 h-16 text-muted-foreground/30 mb-4" />
      <h2 className="font-display text-2xl font-bold mb-2">
        Preferences coming soon
      </h2>
      <p className="text-muted-foreground max-w-md font-body">
        Choose your genre theme, manage reading preferences, and review your
        feedback history.
      </p>
    </div>
  </main>
);

export default Preferences;
