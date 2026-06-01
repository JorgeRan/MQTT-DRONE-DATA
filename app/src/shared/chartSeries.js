export const DASHBOARD_CHART_POINT_LIMIT = 4000;

export function limitSeriesToTail(series, maxPoints = DASHBOARD_CHART_POINT_LIMIT) {
  const safeSeries = Array.isArray(series) ? series : [];
  const safeMaxPoints = Number.isFinite(maxPoints)
    ? Math.max(0, Math.floor(maxPoints))
    : DASHBOARD_CHART_POINT_LIMIT;

  if (safeSeries.length <= safeMaxPoints) {
    return safeSeries;
  }

  return safeSeries.slice(-safeMaxPoints);
}