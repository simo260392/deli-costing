import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface StaffMember {
  id: number;
  name: string;
  role: string;
}

interface StaffSearchPickerProps {
  onSelect: (staff: StaffMember) => void;
  placeholder?: string;
  disabled?: boolean;
  value?: string; // display name of currently selected staff
}

export function StaffSearchPicker({
  onSelect,
  placeholder = "Type name to search…",
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

  // Sync external value changes
  useEffect(() => {
    if (value !== undefined) setQuery(value);
  }, [value]);

  const filtered = query.length >= 2
    ? staffList.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  const handleSelect = (staff: StaffMember) => {
    setQuery(staff.name);
    setOpen(false);
    onSelect(staff);
  };

  // Close dropdown when clicking outside
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
      <Input
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-12 text-base"
        autoComplete="off"
      />

      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          {filtered.map(staff => (
            <button
              key={staff.id}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors",
                "border-b border-border last:border-0"
              )}
              onMouseDown={() => handleSelect(staff)}
            >
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

      {open && query.length >= 2 && filtered.length === 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg px-4 py-3 text-sm text-muted-foreground">
          No staff found matching "{query}"
        </div>
      )}
    </div>
  );
}
