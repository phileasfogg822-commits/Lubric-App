import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import type { CustomerType, PriceSource } from "../../lib/pricing";

/** A customer's group, plus the credit terms that come with it. */
export interface CustomerGroup {
  id: number;
  name: string;
  price_tier: CustomerType;
  credit_days: number;
  credit_limit: number;
}

/**
 * Everything that decides what a CUSTOMER pays, and what they may owe.
 *
 * Deliberately four small queries rather than one wide join. A join of
 * price_list_items against party_prices produces a row per (item, agreed price)
 * pair, which is a cartesian blow-up for no benefit, and a single fat query is
 * harder to read when one of the three tables is empty.
 *
 * Loaded per customer rather than per product: the point of a group is that it
 * decides the price, so switching customer has to re-resolve the whole cart.
 * The query key carries customerId, so React Query refetches exactly when that
 * changes and nothing else.
 *
 * Walk-in customers (no customerId) get an empty context and fall through to the
 * product's own tier columns, which is the same answer they get today.
 */
export function usePriceContext(customerId: number | null): PriceSource & { group?: CustomerGroup | null } {
  const { data } = useQuery({
    queryKey: ["price_ctx", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      if (!customerId) return { priceListId: null, listItems: [], groupListItems: [], partyPrices: [], group: null };

      const [assign, items, agreed, groupRows] = await Promise.all([
        dbSelect<{ price_list_id: number }>(
          `SELECT price_list_id FROM party_price_lists
            WHERE party_type = 'customer' AND party_id = $1`,
          [customerId]
        ),
        dbSelect<{ product_id: number; price: number | null; min_qty: number | null }>(
          `SELECT i.product_id, i.price, i.min_qty
             FROM price_list_items i
             JOIN party_price_lists pll ON pll.price_list_id = i.price_list_id
            WHERE pll.party_type = 'customer' AND pll.party_id = $1`,
          [customerId]
        ),
        dbSelect<{ product_id: number; price: number }>(
          `SELECT product_id, price FROM party_prices
            WHERE party_type = 'customer' AND party_id = $1`,
          [customerId]
        ),
        // The group, its list, and its credit terms in one read. LEFT JOINs
        // throughout: a customer with no group is normal (a walk-in typed
        // directly into the POS), and must not fail the whole query.
        dbSelect<{
          id: number; name: string; price_tier: CustomerType;
          credit_days: number; credit_limit: number; price_list_id: number | null;
        }>(
          `SELECT g.id, g.name, g.price_tier, g.credit_days, g.credit_limit, g.price_list_id
             FROM customer_groups g
             JOIN customers c ON c.group_id = g.id
            WHERE c.id = $1 AND g.active = 1`,
          [customerId]
        ),
      ]);

      const partyPrices: Record<number, number> = {};
      for (const r of agreed) partyPrices[Number(r.product_id)] = Number(r.price);

      // The group's own list, when it has one. Fetched separately rather than
      // joined, so a group with no list costs nothing.
      const groupListId = groupRows.length ? groupRows[0].price_list_id : null;
      const groupItems = groupListId
        ? await dbSelect<{ product_id: number; price: number | null; min_qty: number | null }>(
            `SELECT product_id, price, min_qty FROM price_list_items WHERE price_list_id = $1`,
            [groupListId]
          )
        : [];

      const mapItems = (rows: typeof items) =>
        rows.map((i) => ({
          product_id: Number(i.product_id),
          price: i.price === null ? null : Number(i.price),
          min_qty: i.min_qty === null ? null : Number(i.min_qty),
        }));

      return {
        priceListId: assign.length ? Number(assign[0].price_list_id) : null,
        listItems: mapItems(items),
        groupListItems: mapItems(groupItems),
        groupTier: groupRows.length ? groupRows[0].price_tier : null,
        partyPrices,
        group: groupRows.length
          ? {
              id: Number(groupRows[0].id),
              name: groupRows[0].name,
              price_tier: groupRows[0].price_tier,
              credit_days: Number(groupRows[0].credit_days) || 0,
              credit_limit: Number(groupRows[0].credit_limit) || 0,
            }
          : null,
      };
    },
  });

  // An empty object until the query lands, so the first render of a freshly
  // chosen customer prices from the tier columns and then re-renders with the
  // group - rather than reading `undefined` and throwing mid-bill.
  return data ?? { priceListId: null, listItems: [], groupListItems: [], partyPrices: {}, group: null };
}
