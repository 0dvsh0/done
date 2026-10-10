import type { Economics, SpanRecord } from '../shared/types'

/**
 * The pricing model, planned in cfo.ai and computed here from real usage.
 *
 * The bet: you don't pay for effort, you pay for finished periods. If the
 * agent doesn't get it done, it isn't billed. That only works if the unit
 * cost of a *finished* task is known — so we measure it from the trace
 * instead of guessing it.
 */

/** Personal plan: $12 / month for 100 finished things. */
export const PRICE_PER_PERIOD = 0.12

/** Fixed monthly cost to keep the lights on: storage, telemetry, hosting. */
export const FIXED_MONTHLY = 2.4

/** Used until we have at least three measured runs. */
export const ASSUMED_COST_PER_PERIOD = 0.011

/** Cash on hand at planning time. */
export const CASH_ON_HAND = 4200

/**
 * The cost of one finished period is every span in its trace — planning,
 * the retries, the failed calls, and the verification pass. Failed work is
 * billed to us, which is the whole reason the price has to be measured.
 */
export function measuredCostPerPeriod(spans: Record<string, SpanRecord[]>): number {
  const finished: string[] = []
  for (const [taskId, list] of Object.entries(spans)) {
    const last = list[list.length - 1]
    if (last?.kind === 'CHAIN' && last.name === 'task_complete') finished.push(taskId)
  }
  if (finished.length < 3) return ASSUMED_COST_PER_PERIOD

  const total = finished.reduce((sum, id) => {
    const run = spans[id] ?? []
    // Fixed overhead per run (plan storage, policy checks) plus traced cost.
    const traced = run.reduce((s, sp) => s + (sp.cost ?? 0), 0)
    return sum + traced + 0.0015
  }, 0)

  return total / finished.length
}

function scenario(name: string, periods: number, costPer: number): Economics['scenarios'][number] {
  const revenue = periods * PRICE_PER_PERIOD
  const cost = periods * costPer + FIXED_MONTHLY
  const gross = revenue - cost
  return {
    name,
    customers: periods,
    revenue: round(revenue),
    cost: round(cost),
    gross: round(gross),
    margin: revenue > 0 ? Math.round((gross / revenue) * 100) : 0
  }
}

const round = (n: number): number => Math.round(n * 100) / 100

export function economics(spans: Record<string, SpanRecord[]>): Economics {
  const costPer = measuredCostPerPeriod(spans)
  const periods = 100
  const monthlyRevenue = periods * PRICE_PER_PERIOD
  const monthlyInfra = periods * costPer + FIXED_MONTHLY
  const monthlyGross = monthlyRevenue - monthlyInfra

  return {
    pricePerPeriod: PRICE_PER_PERIOD,
    costPerPeriod: Math.round(costPer * 10000) / 10000,
    marginPct: monthlyRevenue > 0 ? Math.round((monthlyGross / monthlyRevenue) * 100) : 0,
    periodsPerMonth: periods,
    monthlyRevenue: round(monthlyRevenue),
    monthlyInfra: round(monthlyInfra),
    monthlyGross: round(monthlyGross),
    fixedMonthly: FIXED_MONTHLY,
    runwayMonths: monthlyGross > 0 ? Infinity : Math.max(0, round(CASH_ON_HAND / -monthlyGross)),
    scenarios: [
      scenario('Today', periods, costPer),
      scenario('Growth', 250, costPer),
      scenario('Household', 600, costPer * 0.92)
    ]
  }
}
