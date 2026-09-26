import { Skeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-7" aria-busy="true" aria-label="Loading scan">
      <Skeleton className="h-9 w-72" />
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
