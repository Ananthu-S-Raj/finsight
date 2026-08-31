// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { submitMock, getMyReportsMock, toastMocks, hapticMock } = vi.hoisted(() => ({
  submitMock: vi.fn(),
  getMyReportsMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
  hapticMock: vi.fn(),
}));

vi.mock("@/lib/haptics", () => ({ haptic: hapticMock }));
vi.mock("@/lib/useAuth", () => ({ useRequireAuth: () => "u1" }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/lib/finance", () => ({
  getProfile: vi.fn(async () => ({
    full_name: "Test User",
    email: "test@example.com",
    role: "user",
    salary_balance: 0,
    savings_balance: 0,
    monthly_budget: 0,
  })),
}));
vi.mock("@/lib/bugReportsApi", () => ({
  submitBugReport: submitMock,
  getMyBugReports: getMyReportsMock,
}));
vi.mock("@/components/ui/ToastProvider", () => ({
  useToast: () => ({ success: toastMocks.success, error: toastMocks.error }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/PageHeader", () => ({ default: () => <div>header</div> }));
vi.mock("@/components/ui/GlassCard", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/Button", () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/Icons", () => ({
  default: ({ name }: { name: string }) => <span data-icon={name}>.</span>,
}));

import ReportABugPage from "@/app/settings/report-a-bug/page";

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    user_id: "u1",
    title: "Dashboard freezes",
    description: "It freezes whenever I open the overview.",
    category: "bug",
    severity: "high",
    steps_to_reproduce: "Open the overview.",
    expected_behavior: null,
    actual_behavior: null,
    page_url: null,
    user_agent: "Chrome 126",
    status: "open",
    admin_notes: null,
    created_at: "2026-09-02T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    ...overrides,
  };
}

function fillRequiredForm() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Dashboard freezes  " } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  It freezes on load.  " } });
}

function renderPage() {
  render(<ReportABugPage />);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  submitMock.mockResolvedValue({ id: "r-new" });
  getMyReportsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("report-a-bug page", () => {
  it("renders the required form fields and the helpful capture note", async () => {
    renderPage();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity")).toBeInTheDocument();
    expect(screen.getByLabelText("Steps to reproduce")).toBeInTheDocument();
    expect(screen.getByLabelText("Expected behavior")).toBeInTheDocument();
    expect(screen.getByLabelText("Actual behavior")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit bug report" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/include the page you were on/)).toBeInTheDocument();
    });
    expect(getMyReportsMock).toHaveBeenCalledWith("u1");
  });

  it("blocks submission until a title and description are present", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Submit bug report" }));
    expect(await screen.findByText("A title and a description are required.")).toBeInTheDocument();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("submits the trimmed payload, shows the success banner and reloads history", async () => {
    renderPage();
    fillRequiredForm();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "performance" } });
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Steps to reproduce"), { target: { value: "Open the overview." } });

    fireEvent.click(screen.getByRole("button", { name: "Submit bug report" }));

    await waitFor(() => {
      expect(submitMock).toHaveBeenCalledWith({
        title: "  Dashboard freezes  ",
        description: "  It freezes on load.  ",
        category: "performance",
        severity: "high",
        stepsToReproduce: "Open the overview.",
        expectedBehavior: null,
        actualBehavior: null,
      });
    });
    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalledWith("Bug report submitted. Thanks for helping!");
      expect(hapticMock).toHaveBeenCalledWith("success");
      expect(getMyReportsMock).toHaveBeenCalledTimes(2); // mount + reload after submit
    });
    expect(await screen.findByText("Report submitted.")).toBeInTheDocument();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("");
  });

  it("guards against duplicate submissions while pending and disables the button", async () => {
    let release!: (v: { id: string }) => void;
    const gate = new Promise<{ id: string }>((res) => {
      release = res;
    });
    submitMock.mockReturnValueOnce(gate);

    renderPage();
    fillRequiredForm();

    fireEvent.click(screen.getByRole("button", { name: "Submit bug report" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Submitting…" }));
    expect(submitMock).toHaveBeenCalledTimes(1);

    release({ id: "r-x" });
    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled();
    });
  });

  it("surfaces the mapped error message inline and keeps the draft", async () => {
    submitMock.mockRejectedValue(new Error("Please add a title and a description before submitting."));
    renderPage();
    fillRequiredForm();

    fireEvent.click(screen.getByRole("button", { name: "Submit bug report" }));

    expect(
      await screen.findByText("Please add a title and a description before submitting.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Report submitted.")).not.toBeInTheDocument();
    // The form preserves the user's draft on error.
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toContain("Dashboard freezes");
  });

  it("lists the caller's reports with expandable triage details", async () => {
    getMyReportsMock.mockResolvedValue([
      reportRow({
        id: "r1",
        status: "in_progress",
        admin_notes: "Reproduced on our side.",
        expected_behavior: "It loads instantly.",
      }),
    ]);
    renderPage();

    expect(await screen.findByText("Dashboard freezes")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dashboard freezes"));
    expect(screen.getByText("It freezes whenever I open the overview.")).toBeInTheDocument();
    expect(screen.getByText(/Open the overview\./)).toBeInTheDocument();
    expect(screen.getByText("It loads instantly.")).toBeInTheDocument();
    expect(screen.getByText(/Reproduced on our side\./)).toBeInTheDocument();
  });

  it("shows the empty history callout", async () => {
    renderPage();
    expect(await screen.findByText("You haven't reported anything yet.")).toBeInTheDocument();
  });

  it("renders a retry button when the history cannot be loaded", async () => {
    getMyReportsMock.mockRejectedValue(new Error("Could not load your reports. Please try again."));
    renderPage();

    expect(await screen.findByText("Could not load your reports. Please try again.")).toBeInTheDocument();
    getMyReportsMock.mockResolvedValue([reportRow()]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(getMyReportsMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Dashboard freezes")).toBeInTheDocument();
  });
});