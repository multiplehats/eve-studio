export interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isNearBottom(metrics: ScrollMetrics, threshold = 64): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
  )
}
