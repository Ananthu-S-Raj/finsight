"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/ui/GlassCard";
import Button from "@/components/ui/Button";
import Icon, { type IconName } from "@/components/ui/Icons";
import { useRequireAuth } from "@/lib/useAuth";
import { useCategories } from "@/lib/useCategories";
import { getProfile, type Profile } from "@/lib/finance";
import type { Category } from "@/lib/categories";

const CATEGORY_ICONS: Record<string, IconName> = {
  Travel: "bank",
  Food: "wallet",
  Shopping: "tag",
  Other: "tag",
};

type TreeNode = Category & { children: TreeNode[] };

function buildTree(categories: Category[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const nodes: TreeNode[] = (categories ?? []).map((c) => ({ ...c, children: [] }));
  for (const n of nodes) byId.set(n.id, n);
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const parent = n.parent_id ? byId.get(n.parent_id) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export default function CategoriesPage() {
  const userId = useRequireAuth();
  const { categories, loading, error, refresh } = useCategories(userId);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    document.title = "Categories · FinSight";
  }, []);

  useEffect(() => {
    if (!userId) return;
    getProfile(userId).then(setProfile).catch(() => setProfile(null));
  }, [userId]);

  const roots = buildTree(categories ?? []);

  return (
    <AppShell
      userId={userId ?? ""}
      profile={profile ? { full_name: profile.full_name, email: profile.email, role: profile.role } : null}
    >
      <PageHeader title="Categories" subtitle="The standard labels FinSight uses for your money." icon="tag" />

      <div className="space-y-4 animate-fade-up">
        <GlassCard>
          <div className="px-5 py-4">
            <p className="text-[13px] text-slate leading-relaxed">
              Categories are a fixed list shared across every FinSight user, so
              spending is comparable everywhere. Each category can have
              subcategory merchants underneath it — pick a parent category
              when you log money and a merchant for the detail.
            </p>
          </div>
        </GlassCard>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass rounded-2xl p-5 animate-pulse-soft">
                <div className="h-3 w-32 rounded bg-tint-hi" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <GlassCard>
              <div className="px-5 pt-4 pb-1 flex items-center gap-2">
                <Icon name="tag" size={15} className="text-accent" />
                <h2 className="text-[13px] font-bold uppercase tracking-widest text-slate">
                  All categories
                </h2>
              </div>
              <div className="border-t border-line divide-y divide-line">
                {roots.length === 0 ? (
                  <p className="px-5 py-5 text-sm text-slate">
                    No categories available right now.
                  </p>
                ) : (
                  roots.map((c) => (
                    <div key={c.id} className="px-5 py-4">
                      <div className="flex items-center gap-3.5">
                        <span
                          className="h-9 w-9 rounded-xl inline-flex items-center justify-center shrink-0"
                          style={{ background: "#10b9811a", color: "#10b981" }}
                        >
                          <Icon name={CATEGORY_ICONS[c.name] ?? "tag"} size={16} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-snow truncate">{c.name}</p>
                        </div>
                        {c.is_disabled && (
                          <span className="text-[11px] uppercase tracking-wider text-danger/80 border border-danger/30 rounded-full px-2 py-0.5">
                            Disabled
                          </span>
                        )}
                      </div>
                      {c.children.length > 0 && (
                        <div className="mt-3 ml-12 flex flex-wrap gap-2">
                          {c.children.map((child) => (
                            <span
                              key={child.id}
                              className={`text-[12px] rounded-lg px-2.5 py-1 border ${
                                child.is_disabled
                                  ? "text-danger/70 border-danger/20"
                                  : "text-slate border-line bg-tint-hi"
                              }`}
                            >
                              {child.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </GlassCard>

            {error && (
              <Button variant="ghost" full onClick={() => userId && refresh(userId)}>
                Retry
              </Button>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
