import { getAuthenticatedActor, hasPermission } from '../../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const actor = await getAuthenticatedActor(request);
  if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
  if (!hasPermission(actor.role, 'transactions:import')) return Response.json({ error: 'Your role cannot download import templates.' }, { status: 403 });
  const csv = 'id,supplier,amount,pattern,contract_amount_usd,bidder_count,bidding_window_days,price_deviation_pct,invoice_duplicate_count,invoices_last_30d,approval_override_count,approver_vendor_domain_match,split_group_total_usd,supplier_age_days,related_supplier_count\nPO-EXAMPLE-001,Example Supplier,12500,Normal purchase,12500,4,30,2,1,3,0,0,0,1500,0\n';
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="procureguard-import-template.csv"', 'Cache-Control': 'no-store' } });
}
