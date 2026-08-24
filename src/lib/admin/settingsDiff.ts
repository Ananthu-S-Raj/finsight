/**
 * Change detection for admin settings groups.
 *
 * Compares only the declared fields of a group, with per-kind normalization,
 * so server-side extras (e.g. `last_health_check`) never produce phantom
 * diffs and reverting a field to its original value clears the dirty state.
 */

export type SettingFieldKind = "text" | "number" | "toggle" | "select";

export type SettingFieldLike = {
  key: string;
  kind: SettingFieldKind;
};

export function normalizeSettingValue(kind: SettingFieldKind, value: unknown): string {
  if (kind === "toggle") return String(Boolean(value));
  if (kind === "number") {
    const n = Number(value ?? 0);
    return String(Number.isNaN(n) ? 0 : n);
  }
  return String(value ?? "");
}

export function hasSettingChanges(
  fields: readonly SettingFieldLike[],
  initial: Record<string, unknown>,
  draft: Record<string, unknown>
): boolean {
  return fields.some((f) => {
    // A draft key that is absent (undefined) means the field was left
    // untouched and must compare against its original value. An explicitly
    // set value (including null) is treated as a deliberate edit.
    const value = draft[f.key] !== undefined ? draft[f.key] : initial[f.key];
    return normalizeSettingValue(f.kind, value) !== normalizeSettingValue(f.kind, initial[f.key]);
  });
}
