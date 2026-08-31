/**
 * The finite vocabulary of resource_type values written into audit_logs by
 * writeAudit across all admin handlers. Imported by both the audit handler
 * (filter allowlist) and the audit page (filter selector) so the two can
 * never drift. Intentionally dependency-free: it must be safe to import from
 * server handlers and client components alike.
 */
export const AUDIT_RESOURCE_TYPES = [
  "app_settings",
  "bug_report",
  "category",
  "notification",
  "push_subscription",
  "role",
  "system",
  "transaction",
  "user",
] as const;
