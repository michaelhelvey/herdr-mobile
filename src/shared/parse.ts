/** An error that tells why a value from outside the program does not have the expected shape. */
export class ParseError extends Error {
  override name = "ParseError";
}

/** Tells if the value is a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gives the value as an object. Throws a `ParseError` if it is not an object. */
export function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ParseError(`${path}: expected an object`);
  }

  return value;
}

/** Gives the value as an array. Throws a `ParseError` if it is not an array. */
export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ParseError(`${path}: expected an array`);
  }

  return value;
}

/** Gives the value as a string. Throws a `ParseError` if it is not a string. */
export function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ParseError(`${path}: expected a string`);
  }

  return value;
}

/** Gives the value as a number. Throws a `ParseError` if it is not a number. */
export function number(value: unknown, path: string): number {
  if (typeof value !== "number") {
    throw new ParseError(`${path}: expected a number`);
  }

  return value;
}

/** Gives the value as a string, or `null` if the value is `null` or missing. */
export function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return string(value, path);
}
