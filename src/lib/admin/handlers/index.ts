import type { Handler, RouteParams } from "../server";
import { overview } from "./overview";
import { whoami } from "./whoami";
import { getUser, listUsers, requestUserPasswordReset, revokeUserSessions, updateUser } from "./users";
import {
  getRolePermissions,
  grantRolePermission,
  listRoles,
  revokeRolePermission,
} from "./roles";
import {
  correctTransaction,
  deleteTransaction,
  flagTransaction,
  listTransactions,
  unflagTransaction,
} from "./transactions";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "./categories";
import {
  cancelNotification,
  createNotification,
  deleteNotification,
  listNotifications,
  sendNotification,
  updateNotification,
} from "./notifications";
import { deletePushSubscription, listPushSubscriptions } from "./push";
import { listAuditLogs } from "./audit";
import { listBugReports, updateBugReport } from "./bugReports";
import { getSettings, updateSettings } from "./settings";
import { getSystemStatus, setMaintenanceMode } from "./system";
import { getAiStatus } from "./ai";

export type AdminRoute = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  segments: string[];
  handler: Handler;
};

export const adminRoutes: AdminRoute[] = [
  { method: "GET", segments: ["whoami"], handler: whoami },
  { method: "GET", segments: ["overview"], handler: overview },
  { method: "GET", segments: ["users"], handler: listUsers },
  { method: "GET", segments: ["users", ":id"], handler: getUser },
  { method: "PATCH", segments: ["users", ":id"], handler: updateUser },
  { method: "POST", segments: ["users", ":id", "sessions", "revoke"], handler: revokeUserSessions },
  { method: "POST", segments: ["users", ":id", "password-reset"], handler: requestUserPasswordReset },
  { method: "GET", segments: ["roles"], handler: listRoles },
  { method: "GET", segments: ["roles", ":id", "permissions"], handler: getRolePermissions },
  { method: "POST", segments: ["roles", ":id", "permissions"], handler: grantRolePermission },
  { method: "DELETE", segments: ["roles", ":id", "permissions", ":permissionId"], handler: revokeRolePermission },
  { method: "GET", segments: ["transactions"], handler: listTransactions },
  { method: "PATCH", segments: ["transactions", ":id"], handler: correctTransaction },
  { method: "POST", segments: ["transactions", ":id", "flag"], handler: flagTransaction },
  { method: "POST", segments: ["transactions", ":id", "unflag"], handler: unflagTransaction },
  { method: "DELETE", segments: ["transactions", ":id"], handler: deleteTransaction },
  { method: "GET", segments: ["categories"], handler: listCategories },
  { method: "POST", segments: ["categories"], handler: createCategory },
  { method: "PATCH", segments: ["categories", ":id"], handler: updateCategory },
  { method: "DELETE", segments: ["categories", ":id"], handler: deleteCategory },
  { method: "GET", segments: ["notifications"], handler: listNotifications },
  { method: "POST", segments: ["notifications"], handler: createNotification },
  { method: "PATCH", segments: ["notifications", ":id"], handler: updateNotification },
  { method: "POST", segments: ["notifications", ":id", "send"], handler: sendNotification },
  { method: "POST", segments: ["notifications", ":id", "cancel"], handler: cancelNotification },
  { method: "DELETE", segments: ["notifications", ":id"], handler: deleteNotification },
  { method: "GET", segments: ["push-subscriptions"], handler: listPushSubscriptions },
  { method: "DELETE", segments: ["push-subscriptions", ":id"], handler: deletePushSubscription },
  { method: "GET", segments: ["audit-logs"], handler: listAuditLogs },
  { method: "GET", segments: ["bug-reports"], handler: listBugReports },
  { method: "PATCH", segments: ["bug-reports", ":id"], handler: updateBugReport },
  { method: "GET", segments: ["settings"], handler: getSettings },
  { method: "PATCH", segments: ["settings", ":group"], handler: updateSettings },
  { method: "GET", segments: ["system"], handler: getSystemStatus },
  { method: "POST", segments: ["system", "maintenance"], handler: setMaintenanceMode },
  { method: "GET", segments: ["ai", "status"], handler: getAiStatus },
];

export type RouteMatch = { handler: Handler; params: RouteParams };

export function matchRoute(slug: string[], method: string): RouteMatch | null {
  for (const route of adminRoutes) {
    if (route.method !== method) continue;
    if (route.segments.length !== slug.length) continue;
    const params: RouteParams = {};
    let ok = true;
    for (let i = 0; i < slug.length; i += 1) {
      const pattern = route.segments[i];
      if (pattern.startsWith(":")) {
        params[pattern.slice(1)] = slug[i];
      } else if (pattern !== slug[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}
