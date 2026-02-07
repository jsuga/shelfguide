import { MessageSquare } from "lucide-react";

const Copilot = () => (
  <main className="container mx-auto px-4 pt-24 pb-16">
    <div className="mb-8">
      <h1 className="font-display text-4xl font-bold">Reading Copilot</h1>
      <p className="text-muted-foreground mt-2 font-body">
        Your AI-powered reading companion
      </p>
    </div>

    <div className="flex flex-col items-center justify-center py-20 text-center">
      <MessageSquare className="w-16 h-16 text-muted-foreground/30 mb-4" />
      <h2 className="font-display text-2xl font-bold mb-2">
        Chat coming soon
      </h2>
      <p className="text-muted-foreground max-w-md font-body">
        The Reading Copilot will help you discover your next great read with
        personalized, AI-powered recommendations.
      </p>
    </div>
  </main>
);

export default Copilot;
