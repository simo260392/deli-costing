/**
 * SearchableSelect — a combobox that looks like a Select but lets users
 * type to filter items by ANY substring (not just prefix-match).
 *
 * Usage:
 *   <SearchableSelect
 *     value={selectedId}           // string value of the selected item
 *     onValueChange={setSelected}  // called with the item's value
 *     options={[{ value: "1", label: "Dried Parsley", group?: "Spices" }]}
 *     placeholder="Search…"
 *     className="h-8 text-sm"      // forwarded to trigger button
 *   />
 */
import { useState, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label: string;
  group?: string;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
};

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Search…",
  emptyText = "No results found.",
  className,
  disabled,
  "data-testid": testId,
}: Props) {
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value);

  // Group options if any have a `group` field
  const groups = Array.from(new Set(options.map((o) => o.group || ""))).filter(Boolean);
  const hasGroups = groups.length > 0;
  const ungrouped = options.filter((o) => !o.group);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)", minWidth: 200 }}
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            // Find the option label for this value and do substring match
            const opt = options.find((o) => o.value === itemValue);
            if (!opt) return 0;
            return opt.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {hasGroups ? (
              <>
                {groups.map((group) => (
                  <CommandGroup key={group} heading={group}>
                    {options
                      .filter((o) => o.group === group)
                      .map((opt) => (
                        <CommandItem
                          key={opt.value}
                          value={opt.value}
                          onSelect={() => {
                            onValueChange(opt.value);
                            setOpen(false);
                          }}
                        >
                          <Check
                            size={14}
                            className={cn("mr-2 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")}
                          />
                          {opt.label}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                ))}
                {ungrouped.length > 0 && (
                  <CommandGroup>
                    {ungrouped.map((opt) => (
                      <CommandItem
                        key={opt.value}
                        value={opt.value}
                        onSelect={() => {
                          onValueChange(opt.value);
                          setOpen(false);
                        }}
                      >
                        <Check
                          size={14}
                          className={cn("mr-2 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")}
                        />
                        {opt.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            ) : (
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      size={14}
                      className={cn("mr-2 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")}
                    />
                    {opt.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
