import { assertSupabase } from './supabase-server';

/** Supabase REST returns at most 1,000 rows per request. This helper makes
 * whole-dataset computations explicit and safe for the dissertation dataset. */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1_000,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    assertSupabase(result);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function paginationFromRequest(request: Request, defaultPageSize = 50) {
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const requestedPageSize = Number.parseInt(params.get('pageSize') ?? String(defaultPageSize), 10);
  const pageSize = Math.min(100, Math.max(10, requestedPageSize || defaultPageSize));
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}
