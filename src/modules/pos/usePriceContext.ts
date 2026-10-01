import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import type { PriceSource } from "../../lib/pricing";

/**
 * Everything that decides what a CUSTOMER pays, loaded once per customer.
 *
 * Deliberately three small queries rather than one wide join. A join of
 * price_list_items against party_prices produces a row per (item, agreed price)
 * pair, which is a cartesian blow-up for no benefit, and a single fat query is
 * harder to read when one of the three tables is empty.
 *
 * Loaded per customer rather than per product: the whole point of a price list
 * is that it is the customer's list, so switching customer has to re-resolve
 * the cart. The query key carries customerId, so React Query refetches exactly
 * when that changes and nothing else.
 *
 * Walk-in customers (no customerId) get an empty context and fall through to the
 * product's own tier columns, which is the same answer they get today.
 */
export function usePriceContext(customerId: number | null): PriceSource {
  const { data } = useQuery({
    queryKey: ["price_ctx", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      if (!customerId) return { listId: null, listItems: [], partyPrices: {} };

      const [assign, items, agreed] = await Promise.all([
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
      ]);

      // party_prices is keyed by product so resolvePrice can answer in one
      // lookup, which is what keeps a whole bill a single pass.
      const partyPrices: Record<number, number> = {};
      for (const r of agreed) partyPrices[Number(r.product_id)] = Number(r.price);

      return {
        priceListId: assign.length ? Number(assign[0].price_list_id) : null,
        listItems: items.map((i) => ({
          product_id: Number(i.product_id),
          price: i.price === null ? null : Number(i.price),
          min_qty: i.min_qty === null ? null : Number(i.min_qty),
        })),
        partyPrices,
      };
    },
  });

  // An empty object until the query lands, so the first render of a freshly
  // chosen customer prices from the tier columns and then re-renders with the
  // list - rather than reading `undefined` and throwing mid-bill.
  return data ?? { priceListId: null, listItems: [], partyPrices: {} };
}
