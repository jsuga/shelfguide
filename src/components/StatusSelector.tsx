import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "tbr", label: "TBR" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "paused", label: "Paused" },
];

type StatusSelectorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

const StatusSelector = ({ value, onChange, disabled, className }: StatusSelectorProps) => {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={cn("h-7 text-[11px] px-2", className)}>
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default StatusSelector;
