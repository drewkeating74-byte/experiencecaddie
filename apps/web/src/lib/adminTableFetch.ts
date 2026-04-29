import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type KnownTable = keyof Database["public"]["Tables"];

const PAGE_SIZE = 1000;

/** Load every row (PostgREST default caps at ~PAGE_SIZE unless paged). */
export async function fetchAllPaged<T>(
  run: (
    rangeFrom: number,
    rangeTo: number,
  ) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await run(from, to);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

/** All id/name pairs from a table, ordered by name (for dropdowns). */
export async function fetchAllIdNamePairs(tab: KnownTable): Promise<{ id: string; name: string | null }[]> {
  return fetchAllPaged((from, to) =>
    supabase.from(tab).select("id, name").order("name", { ascending: true }).range(from, to),
  );
}
