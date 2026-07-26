import { Badge } from "@/components/ui/badge";
import { Globe, Lock, Users } from "lucide-react";
import type { Memory } from "@/lib/types";

export function CollectionBadge({
  visibility,
  collection,
}: {
  visibility: Memory["visibility"];
  collection?: string;
}) {
  const map = {
    public: { label: "Public", Icon: Globe, className: "bg-primary/10 text-primary border-primary/20" },
    shared: { label: "Shared", Icon: Users, className: "bg-success/10 text-success border-success/20" },
    private: { label: "Private", Icon: Lock, className: "bg-muted text-muted-foreground border-border" },
  }[visibility];
  const { Icon } = map;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className={`gap-1 rounded-full ${map.className}`}>
        <Icon className="h-3 w-3" />
        {map.label}
      </Badge>
      {collection && (
        <Badge variant="outline" className="gap-1 rounded-full">
          {collection}
        </Badge>
      )}
    </div>
  );
}
