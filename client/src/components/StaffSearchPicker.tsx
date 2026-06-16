import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { User } from "lucide-react";

interface StaffMember {
  id: number;
  name: string;
  role: string;
}

interface StaffSearchPickerProps {
  onSelect: (staff: StaffMember) => void;
  placeholder?: string;
  disabled?: boolean;
  value?: string;
}

export function StaffSearchPicker({
  onSelect,
  placeholder = "Search staff…",
  disabled = false,
  value,
}: StaffSearchPickerProps) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: staffList = [] } = useQuery<StaffMember[]>({
    queryKey: ["/api/compliance/staff"],
    queryFn: () => apiRequest("GET", "/api/compliance/staff").then(r => r.json()),
  });

  useEffect(() => {
    if (value !== undefined) setQuery(value);
  }, [value]);

  const filtered = query.length >= 1
    ? staffList.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : staffList.slice(0, 8); // show first 8 on focus with no query

  const handleSelect = (staff: StaffMember) => {
    setQuery(staff.name);
    setOpen(false);
    onSelect(staff);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Input with user icon */}
      <div className="relative">
        <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm ring-offset-background",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.map(staff => (
            <button
              key={staff.id}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors",
                "border-b border-border last:border-0"
              )}
              onMouseDown={() => handleSelect(staff)}
            >
              <User size={13} className="text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium text-sm">{staff.name}</div>
                {staff.role && (
                  <div className="text-xs text-muted-foreground">{staff.role}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 1 && filtered.length === 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg px-4 py-3 text-sm text-muted-foreground">
          No staff found matching "{query}"
        </div>
      )}
    </div>
  );
}
