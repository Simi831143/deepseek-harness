/** Market UI configuration shared by the Host and Client faces; types only. */
import type { Volatile } from '@deepseek-ai/cordis'

/** Live catalog revalidation delay; the browser receives it through its synced Config. */
export interface MarketUiConfig {
  /** Delay in milliseconds between timed catalog revalidations while the market page is open and its window visible. */
  catalogRevalidateMs: Volatile<number>
}
