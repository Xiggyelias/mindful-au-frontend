type EmergencyLocationOptions = {
  timeoutMs?: number;
  responseDeadlineMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RESPONSE_DEADLINE_MS = 4500;

function formatCoordinate(value: number): string {
  const rounded = Number(value.toFixed(7));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function formatAccuracy(accuracy: number): string {
  if (accuracy < 10) return `${Math.round(accuracy * 10) / 10}m`;
  return `${Math.round(accuracy)}m`;
}

function formatEmergencyLocation(coords: GeolocationCoordinates): string {
  const lat = formatCoordinate(coords.latitude);
  const lng = formatCoordinate(coords.longitude);
  const accuracy = Number(coords.accuracy);

  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return `${lat},${lng}`;
  }

  return `${lat},${lng} (accuracy: ~${formatAccuracy(accuracy)})`;
}

export async function getEmergencyLocation({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  responseDeadlineMs = DEFAULT_RESPONSE_DEADLINE_MS,
}: EmergencyLocationOptions = {}): Promise<string | undefined> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return undefined;
  }

  try {
    const positionPromise = new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: timeoutMs,
      });
    });

    const position = await Promise.race([
      positionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), responseDeadlineMs)),
    ]);

    return position ? formatEmergencyLocation(position.coords) : undefined;
  } catch {
    return undefined;
  }
}
