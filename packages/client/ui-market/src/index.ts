/** Host Loader entry declaring the market page's catalog revalidation delay; the page belongs to the Client. */
import z from '@deepseek-ai/schemastery'
import type { MarketUiConfig } from './types.ts'

/** Live catalog revalidation delay; the browser receives it through its synced Config. */
export type Config = MarketUiConfig

/** Live catalog revalidation delay synced to the browser; at most the longest browser timer delay. */
export const Config = z.object({
  catalogRevalidateMs: z.natural().min(1).max(2_147_483_647).default(60_000).volatile(),
})

/** Register the browser plugin without Host behavior. */
export function apply(): void {}
