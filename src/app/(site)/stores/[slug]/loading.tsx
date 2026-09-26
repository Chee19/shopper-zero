import { Skeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 py-8 md:px-7" aria-busy="true" aria-label="Loading store">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-36" />
      <Skeleton className="h-64" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}
      </div>
    </div>
  );
}
