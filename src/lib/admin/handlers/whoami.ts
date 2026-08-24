import type { AdminContext, Handler } from "../server";

export const whoami: Handler = async (ctx) => ({
  id: ctx.userId,
  email: ctx.email,
  role: ctx.role,
  permissions: ctx.permissions,
});
