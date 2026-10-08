/**
 * ETA canonical serialization (Egyptian Tax Authority SDK, "Document
 * serialization approach for signature"):
 *
 *   Serialize(value):
 *     simple value  -> "\"" + value + "\""
 *     object        -> for each property in document order:
 *                        not an array -> "\"" + NAME.toUpperCase() + "\"" + Serialize(value)
 *                        array        -> "\"" + NAME.toUpperCase() + "\""
 *                                        then for each element:
 *                                          "\"" + NAME.toUpperCase() + "\"" + Serialize(element)
 *
 * Values are emitted exactly as they appear in the JSON text that is sent to
 * ETA (numbers use JavaScript's shortest round-trip formatting, which is what
 * JSON.stringify produces), with no escaping. The same object must therefore
 * be serialized for signing and sent in the HTTP body. `signatures` is never
 * part of the signed content and must be absent when serializing.
 *
 * The e-receipt UUID uses the same algorithm (receipt with header.uuid = "").
 */
export function etaSerialize(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value !== 'object') return `"${formatScalar(value)}"`;
  if (Array.isArray(value)) {
    // Arrays are only meaningful under a property name; a bare array
    // serializes its elements back to back.
    return value.map((v) => etaSerialize(v)).join('');
  }
  let out = '';
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined) continue;
    const name = `"${key.toUpperCase()}"`;
    if (Array.isArray(child)) {
      out += name;
      for (const element of child) out += name + etaSerialize(element);
    } else {
      out += name + etaSerialize(child);
    }
  }
  return out;
}

function formatScalar(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('ETA documents cannot contain non-finite numbers');
    // Same textual form as JSON.stringify (e.g. 1 -> "1", 0.5 -> "0.5").
    return JSON.stringify(value);
  }
  return String(value);
}

/** Removes the signatures before serializing a document for signing. */
export function etaSerializeForSigning(document: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signatures, ...unsigned } = document;
  return etaSerialize(unsigned);
}
