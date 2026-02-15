import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

type StarRatingProps = {
  value?: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
  saving?: boolean;
  className?: string;
};

const StarRating = ({ value, onChange, disabled, saving, className }: StarRatingProps) => {
  const current = value ?? 0;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={cn(
            "transition",
            n <= current ? "text-primary" : "text-muted-foreground/30",
            disabled ? "cursor-not-allowed opacity-60" : "hover:text-primary"
          )}
          onClick={() => {
            if (disabled) return;
            const next = n === current ? null : n;
            onChange(next);
          }}
          aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
        >
          <Star className={cn("h-3 w-3", n <= current ? "fill-primary" : "fill-none")} />
        </button>
      ))}
      {saving && <span className="text-[10px] text-muted-foreground ml-1">Saving...</span>}
      {!saving && current > 0 && (
        <button
          type="button"
          className={cn("text-[10px] text-muted-foreground ml-2", disabled ? "cursor-not-allowed" : "hover:text-foreground")}
          onClick={() => {
            if (disabled) return;
            onChange(null);
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
};

export default StarRating;
