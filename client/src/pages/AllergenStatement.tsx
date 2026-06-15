import { FileText } from "lucide-react";

export default function AllergenStatement() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b">
        <h1 className="text-2xl font-bold">Allergen Statement</h1>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <FileText size={32} className="text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Coming soon</h2>
          <p className="text-muted-foreground text-sm">
            Generate per-product allergen statement PDFs. This feature will let you produce
            compliant allergen declarations for individual products from your recipe data.
          </p>
        </div>
      </div>
    </div>
  );
}
