// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BroadcastInbox from "@/components/BroadcastInbox";
import type { BroadcastItem } from "@/lib/notificationsServer";

vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
const { listBroadcasts, markBroadcastRead } = vi.hoisted(() => ({
  listBroadcasts: vi.fn(),
  markBroadcastRead: vi.fn(),
}));
vi.mock("@/lib/broadcastsApi", () => ({ listBroadcasts, markBroadcastRead }));

function item(over: Partial<BroadcastItem> = {}): BroadcastItem {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    title: "Maintenance window",
    body: "The app will be briefly unavailable.",
    audience: "all",
    channel: "inapp",
    sent_at: "2026-08-20T12:00:00Z",
    created_at: "2026-08-20T11:59:59Z",
    is_read: false,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BroadcastInbox", () => {
  it("shows a loading skeleton first", () => {
    listBroadcasts.mockReturnValue(new Promise(() => {}));
    render(<BroadcastInbox />);
    expect(screen.getByRole("status", { name: "Loading announcements" })).toBeInTheDocument();
  });

  it("renders broadcasts with read state and marks one read on tap", async () => {
    markBroadcastRead.mockResolvedValue({ id: "n2", read: true });
    listBroadcasts.mockResolvedValue({
      items: [item(), item({ id: "00000000-0000-4000-8000-000000000102", title: "Old news", is_read: true })],
      total: 2,
      page: 1,
      pageSize: 10,
      pages: 1,
      unread: 1,
    });
    render(<BroadcastInbox />);

    expect(await screen.findByText("Maintenance window")).toBeInTheDocument();
    expect(screen.getByText("Old news")).toBeInTheDocument();
    expect(screen.getByLabelText(/Unread/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/^Maintenance window/));
    await waitFor(() =>
      expect(screen.getByLabelText(/^Maintenance window/).getAttribute("aria-label")).toContain("Read")
    );
    expect(markBroadcastRead).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000101");
  });

  it("rolls the row back to unread when the server rejects the mark", async () => {
    markBroadcastRead.mockRejectedValue(new Error("offline"));
    listBroadcasts.mockResolvedValue({
      items: [item()],
      total: 1,
      page: 1,
      pageSize: 10,
      pages: 1,
      unread: 1,
    });
    render(<BroadcastInbox />);

    const row = await screen.findByLabelText(/Unread/);
    fireEvent.click(row);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Maintenance window/).getAttribute("aria-label")).toContain("Unread")
    );
  });

  it("shows an empty state when nothing has been broadcast", async () => {
    listBroadcasts.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      pages: 1,
      unread: 0,
    });
    render(<BroadcastInbox />);
    expect(await screen.findByText("No announcements yet")).toBeInTheDocument();
  });

  it("offers a retry after a load failure", async () => {
    listBroadcasts.mockRejectedValueOnce(new Error("boom"));
    render(<BroadcastInbox />);
    const retry = await screen.findByRole("button", { name: /try again/i });
    listBroadcasts.mockResolvedValue({
      items: [item()],
      total: 1,
      page: 1,
      pageSize: 10,
      pages: 1,
      unread: 1,
    });
    fireEvent.click(retry);
    expect(await screen.findByText("Maintenance window")).toBeInTheDocument();
    expect(listBroadcasts).toHaveBeenCalledTimes(2);
  });

  it("loads more pages on demand", async () => {
    markBroadcastRead.mockResolvedValue({ id: "x", read: true });
    const second = item({
      id: "00000000-0000-4000-8000-000000000102",
      title: "Page two broadcast",
    });
    listBroadcasts
      .mockResolvedValueOnce({
        items: [item()],
        total: 2,
        page: 1,
        pageSize: 10,
        pages: 2,
        unread: 2,
      })
      .mockResolvedValueOnce({
        items: [second],
        total: 2,
        page: 2,
        pageSize: 10,
        pages: 2,
        unread: 1,
      });
    render(<BroadcastInbox />);

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));
    expect(await screen.findByText("Page two broadcast")).toBeInTheDocument();
    expect(listBroadcasts).toHaveBeenLastCalledWith(2, 10);
  });
});
