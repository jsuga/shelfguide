import { BookMarked, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const Library = () => (
  <main className="container mx-auto px-4 pt-24 pb-16">
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="font-display text-4xl font-bold">My Library</h1>
        <p className="text-muted-foreground mt-2 font-body">
          Your personal book collection
        </p>
      </div>
      <Button>
        <Plus className="w-4 h-4 mr-2" /> Add Book
      </Button>
    </div>

    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BookMarked className="w-16 h-16 text-muted-foreground/30 mb-4" />
      <h2 className="font-display text-2xl font-bold mb-2">No books yet</h2>
      <p className="text-muted-foreground max-w-md font-body">
        Start building your library by adding books you've read, are reading, or
        want to read.
      </p>
    </div>
  </main>
);

export default Library;
