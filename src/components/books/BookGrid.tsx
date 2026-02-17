import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BookGridProps = {
  children: ReactNode;
  className?: string;
};

const BookGrid = ({ children, className }: BookGridProps) => (
  <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>
    {children}
  </div>
);

export default BookGrid;
