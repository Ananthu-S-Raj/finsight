/** Permission codes and per-role maps for the Admin Console. */

export const PERMISSIONS = {
  USER_VIEW: "USER_VIEW",
  USER_EDIT: "USER_EDIT",
  USER_SUSPEND: "USER_SUSPEND",
  ROLE_MANAGE: "ROLE_MANAGE",
  TRANSACTION_VIEW: "TRANSACTION_VIEW",
  TRANSACTION_EDIT: "TRANSACTION_EDIT",
  TRANSACTION_DELETE: "TRANSACTION_DELETE",
  CATEGORY_MANAGE: "CATEGORY_MANAGE",
  NOTIFICATION_MANAGE: "NOTIFICATION_MANAGE",
  SYSTEM_SETTINGS: "SYSTEM_SETTINGS",
  AI_SETTINGS: "AI_SETTINGS",
  PWA_SETTINGS: "PWA_SETTINGS",
  AUDIT_LOG_VIEW: "AUDIT_LOG_VIEW",
  REPORT_VIEW: "REPORT_VIEW",
  BUG_REPORT_MANAGE: "BUG_REPORT_MANAGE",
  ADMIN_CONSOLE_ACCESS: "ADMIN_CONSOLE_ACCESS",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  USER_VIEW: "View users",
  USER_EDIT: "Edit users",
  USER_SUSPEND: "Suspend / disable users",
  ROLE_MANAGE: "Manage roles",
  TRANSACTION_VIEW: "View transactions",
  TRANSACTION_EDIT: "Edit transactions",
  TRANSACTION_DELETE: "Delete transactions",
  CATEGORY_MANAGE: "Manage categories",
  NOTIFICATION_MANAGE: "Send notifications",
  SYSTEM_SETTINGS: "System settings",
  AI_SETTINGS: "AI settings",
  PWA_SETTINGS: "PWA settings",
  AUDIT_LOG_VIEW: "View audit logs",
  REPORT_VIEW: "View reports",
  BUG_REPORT_MANAGE: "View and manage bug reports",
  ADMIN_CONSOLE_ACCESS: "Admin console access",
};
