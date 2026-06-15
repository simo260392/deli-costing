import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumberPadModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title?: string;
  unit?: string;
  initialValue?: string;
}

export function NumberPadModal({
  open,
  onClose,
  onConfirm,
  title = "Enter value",
  unit,
  initialValue = "",
}: NumberPadModalProps) {
  const [value, setValue] = useState(initialValue);

  const handleKey = (key: string) => {
    if (key === "backspace") {
      setValue(v => v.slice(0, -1));
    } else if (key === "clear") {
      setValue("");
    } else if (key === ".") {
      if (!value.includes(".")) setValue(v => v + ".");
    } else {
      // Prevent multiple leading zeros
      if (value === "0" && key !== ".") {
        setValue(key);
      } else {
        setValue(v => v + key);
      }
    }
  };

  const handleConfirm = () => {
    if (value !== "") {
      onConfirm(value);
      onClose();
    }
  };

  const handleClose = () => {
    setValue(initialValue);
    onClose();
  };

  const keys = [
    ["7", "8", "9"],
    ["4", "5", "6"],
    ["1", "2", "3"],
    [".", "0", "backspace"],
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm mx-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-center text-lg">{title}</DialogTitle>
        </DialogHeader>

        {/* Display */}
        <div className="flex items-center justify-center gap-2 py-3 px-4 bg-muted rounded-lg min-h-[64px]">
          <span className="text-4xl font-mono font-bold tracking-wide tabular-nums min-w-[80px] text-right">
            {value || "—"}
          </span>
          {unit && (
            <span className="text-2xl text-muted-foreground font-medium">{unit}</span>
          )}
        </div>

        {/* Number pad */}
        <div className="grid gap-2">
          {keys.map((row, ri) => (
            <div key={ri} className="grid grid-cols-3 gap-2">
              {row.map(key => (
                <Button
                  key={key}
                  variant="outline"
                  className={cn(
                    "h-16 text-xl font-semibold rounded-xl border-border transition-all active:scale-95",
                    key === "backspace" && "text-muted-foreground"
                  )}
                  onClick={() => handleKey(key)}
                >
                  {key === "backspace" ? <Delete size={22} /> : key}
                </Button>
              ))}
            </div>
          ))}

          {/* Clear + Confirm row */}
          <div className="grid grid-cols-2 gap-2 mt-1">
            <Button
              variant="ghost"
              className="h-14 text-base font-medium text-muted-foreground rounded-xl"
              onClick={() => handleKey("clear")}
            >
              Clear
            </Button>
            <Button
              className="h-14 text-base font-semibold rounded-xl"
              style={{ backgroundColor: "#256984" }}
              disabled={!value}
              onClick={handleConfirm}
            >
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
