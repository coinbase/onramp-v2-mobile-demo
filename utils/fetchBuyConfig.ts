// utils/fetchBuyConfig.ts
import { BASE_URL } from "../constants/BASE_URL";
import { authenticatedFetch } from "./authenticatedFetch";

export async function fetchBuyConfig() {
  const res = await authenticatedFetch(`${BASE_URL}/onramp/config`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return res.json(); // shape: { countries: [{ id: 'US', subdivisions: ['CA', 'NY', ...], payment_methods: [...] }, ...] }
}