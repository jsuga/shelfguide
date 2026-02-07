import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navLinks = [
  { path: "/", label: "Home" },
  { path: "/library", label: "My Library" },
  { path: "/copilot", label: "Copilot" },
  { path: "/preferences", label: "Preferences" },
];

const Navbar = () => {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <nav className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-xl font-bold tracking-tight"
        >
          <BookOpen className="w-6 h-6 text-primary" />
          <span>Reading Copilot</span>
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
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  );
};

export default Navbar;
