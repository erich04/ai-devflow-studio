export function isFinalPostgresReady({
  healthStatus,
  initProcessName,
  liveProbeReady,
}) {
  return (
    healthStatus === 'healthy' &&
    initProcessName === 'postgres' &&
    liveProbeReady === true
  )
}

export async function waitForFinalPostgresReadiness({
  readObservation,
  delay = () => new Promise((resolve) => setTimeout(resolve, 250)),
  maxAttempts = 120,
}) {
  let latestObservation = {
    healthStatus: 'unknown',
    initProcessName: 'unavailable',
    liveProbeReady: false,
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    latestObservation = await readObservation()
    if (isFinalPostgresReady(latestObservation)) return latestObservation
    if (attempt + 1 < maxAttempts) await delay()
  }

  throw new Error(
    `Timed out waiting for final lifecycle Postgres readiness (health=${latestObservation.healthStatus}, pid1=${latestObservation.initProcessName}, liveProbe=${latestObservation.liveProbeReady}).`,
  )
}
