import { authenticateRequest, handleRoute, json } from "@/lib/admin/server";
import { adminRoutes, matchRoute } from "@/lib/admin/handlers";

export const dynamic = "force-dynamic";

async function run(
  req: Request,
  { params }: { params: Promise<{ slug?: string | string[] }> }
) {
  const { slug: rawSlug } = await params;
  const slug = (Array.isArray(rawSlug) ? rawSlug : [rawSlug]).filter((s): s is string => s != null);

  const auth = await authenticateRequest(req);
  if (!auth.ok) return json({ error: auth.error.message, code: auth.error.code, status: auth.error.status }, auth.error.status);

  const match = matchRoute(slug, req.method);
  if (!match) {
    return json(
      { error: `No admin route for ${req.method} /admin/${slug.join("/")}.`, code: "not_found", status: 404 },
      404
    );
  }

  return handleRoute(() => match.handler(auth.ctx, req, match.params));
}

export const GET = run;
export const POST = run;
export const PATCH = run;
export const DELETE = run;
