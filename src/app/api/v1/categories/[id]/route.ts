import { json } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

/**
 * Custom-category management was removed from the user API: categories are a
 * single admin-managed canonical list. The endpoint stays for compatibility
 * but always refuses the request.
 */
export async function DELETE(): Promise<Response> {
  return json(
    { error: "Categories are admin-managed.", code: "method_not_allowed" },
    405
  );
}
