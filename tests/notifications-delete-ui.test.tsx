// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { useAdminDataMock, useAdminAuthMock, adminFetchMock, toastMocks } = vi.hoisted(() => ({
  useAdminDataMock: vi.fn(),
  useAdminAuthMock: vi.fn(),
  adminFetchMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/admin/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/admin/client")>();
  return {
    ...original,
    useAdminAuth: useAdminAuthMock,
    adminFetch: (...args: unknown[]) => adminFetchMock(...(args as [])),
  };
});
vi.mock("@/lib/admin/useAdminData", () => ({ useAdminData: useAdminDataMock }));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastMocks.success, error: toastMocks.error }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/notifications",
}));
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: vi.fn(async () => ({})) } },
}));

import AdminNotificationsPage from "@/app/admin/notifications/page";

const SENT_ID = "00000000-0000-4000-8000-000000000101";
const CANCELLED_ID = "00000000-0000-4000-8000-000000000102";
const DRAFT_ID = "00000000-0000-4000-8000-000000000103";

function notif(id: string, title: string, status: string, extra = {}) {
  return {
    id,
    title,
    body: `Body of ${title}`,
    audience: "all",
    target_user_ids: null,
    channel: "inapp",
    status,
    error: null,
    created_by: "00000000-0000-4000-8000-000000000001",
    created_at: "2026-08-20T10:00:00Z",
    sent_at: status === "sent" ? "2026-08-20T11:00:00Z" : null,
    ...extra,
  };
}

function defaultItems() {
  return [
    notif(SENT_ID, "Sent broadcast", "sent"),
    notif(CANCELLED_ID, "Cancelled broadcast", "cancelled"),
    notif(DRAFT_ID, "Draft broadcast", "draft"),
  ];
}

beforeEach(() => {
  cleanup();
  adminFetchMock.mockReset();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  refreshMock.mockReset();
  currentItems = defaultItems;
  useAdminAuthMock.mockReturnValue({
    status: "ready",
    whoami: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "admin@finsight.app",
      role: "admin",
      permissions: ["NOTIFICATION_MANAGE"],
    },
  });
  useAdminDataMock.mockImplementation(() => {
    // Return the CURRENT table contents so a post-delete refresh re-renders.
    return {
      status: "ready",
      data: { items: currentItems(), total: currentItems().length, page: 1, pageSize: 15, pages: 1 },
      error: null,
      refresh: refreshMock,
    };
  });
});

const refreshMock = vi.fn();
let currentItems = defaultItems;

describe("broadcast deletion UI (G-04)", () => {
  it("offers Delete for sent and cancelled broadcasts", () => {
    render(<AdminNotificationsPage />);
    expect(within(rowOf("Sent broadcast")).getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(within(rowOf("Cancelled broadcast")).getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("hides Delete for drafts and other non-terminal rows", () => {
    currentItems = () => [
      notif(DRAFT_ID, "Draft broadcast", "draft"),
      notif(SENT_ID, "Failed broadcast", "failed"),
      notif(CANCELLED_ID, "Sending broadcast", "sending"),
    ];
    render(<AdminNotificationsPage />);
    for (const title of ["Draft broadcast", "Failed broadcast", "Sending broadcast"]) {
      expect(within(rowOf(title)).queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    }
  });

  it("shows no destructive actions without NOTIFICATION_MANAGE", () => {
    useAdminAuthMock.mockReturnValue({
      status: "ready",
      whoami: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "viewer@finsight.app",
        role: "admin",
        permissions: ["USER_VIEW"],
      },
    });
    render(<AdminNotificationsPage />);
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("sends the armed DELETE request with explicit confirmation and refreshes the list", async () => {
    currentItems = () => [notif(SENT_ID, "Sent broadcast", "sent")];
    adminFetchMock.mockResolvedValue({ id: SENT_ID, deleted: true });
    render(<AdminNotificationsPage />);

    // Arm…
    fireEvent.click(within(rowOf("Sent broadcast")).getByRole("button", { name: /delete/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/permanently|delete/i);

    const confirm = within(dialog).getByRole("button", { name: /delete notification/i });
    fireEvent.click(confirm); // arms
    fireEvent.click(confirm); // fires
    await waitFor(async () => {
      expect(adminFetchMock).toHaveBeenCalledTimes(1);
    });
    expect(adminFetchMock).toHaveBeenCalledWith(`/notifications/${SENT_ID}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(toastMocks.success).toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("dismisses the confirmation without any request", async () => {
    render(<AdminNotificationsPage />);
    fireEvent.click(within(rowOf("Sent broadcast")).getByRole("button", { name: /delete/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(adminFetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps the row and surfaces an error when deletion fails", async () => {
    currentItems = () => [notif(SENT_ID, "Sent broadcast", "sent")];
    adminFetchMock.mockRejectedValue(new Error("Could not delete the notification."));
    render(<AdminNotificationsPage />);

    fireEvent.click(within(rowOf("Sent broadcast")).getByRole("button", { name: /delete/i }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: /delete notification/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    // Row untouched.
    expect(screen.getByText("Sent broadcast")).toBeInTheDocument();
  });
});

function rowOf(title: string): HTMLElement {
  return screen.getByText(title).closest("div.px-5") as HTMLElement;
}
