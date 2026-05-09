import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, ImageIcon } from "lucide-react";
import { apiRequest, assetUrl } from "@/lib/queryClient";

interface PhotoUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  className?: string;
  square?: boolean;
}

export function PhotoUpload({ value, onChange, className, square }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await apiRequest("POST", "/api/upload-photo", form);
      const data = await res.json();
      if (data.url) onChange(data.url);
    } catch {
      // silently fail
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className={className}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      {value ? (
        <div className={`relative w-full ${square ? "aspect-square" : "aspect-video"} rounded-lg overflow-hidden border border-border bg-muted/30`}>
          <img src={assetUrl(value)} alt="Dish photo" className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80 transition-colors"
            title="Remove photo"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute bottom-1.5 right-1.5 bg-black/60 text-white rounded-md px-2 py-1 text-xs hover:bg-black/80 transition-colors flex items-center gap-1"
          >
            <Camera size={11} /> Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-border rounded-lg p-5 text-center hover:border-primary/50 hover:bg-muted/20 transition-colors flex flex-col items-center gap-2 text-muted-foreground"
        >
          <ImageIcon size={24} />
          <span className="text-xs font-medium">
            {uploading ? "Uploading…" : "Upload dish photo"}
          </span>
          <span className="text-xs opacity-70">JPG, PNG, WebP — max 8 MB</span>
        </button>
      )}
    </div>
  );
}
