function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function getStoredString(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!hasOwn(params, key)) return undefined;
  const value = params[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function getStoredNumberWithLegacyScaling(
  params: Record<string, unknown>,
  key: string,
  legacyMax: number,
): number | undefined {
  const raw = getStoredString(params, key);
  if (raw === undefined) return undefined;

  let value = parseFloat(raw);
  if (!Number.isFinite(value)) return undefined;

  if (value > legacyMax) {
    value /= 100;
  }

  return value;
}

export function getStoredBoolean(
  params: Record<string, unknown>,
  key: string,
): boolean | undefined {
  if (!hasOwn(params, key)) return undefined;
  const value = params[key];
  if (typeof value === "boolean") return value;
  return undefined;
}
