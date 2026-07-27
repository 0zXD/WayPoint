import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function UploadFab({ className }: { className?: string }) {
  const setOpen = useAppStore((s) => s.setUploadOpen);
  return (
    <Button
      onClick={() => setOpen(true)}
      className={cn(
        "pointer-events-auto h-9 w-9 sm:h-14 sm:w-14 rounded-full p-0 shadow-2xl transition-transform hover:scale-105 gradient-accent text-primary-foreground cursor-pointer flex items-center justify-center",
        className
      )}
      aria-label="New memory"
    >
      <Plus className="h-4 w-4 sm:h-6 sm:w-6" />
    </Button>
  );
}
