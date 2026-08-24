// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import BirthdayGreeting from "@/components/BirthdayGreeting";

vi.mock("@/lib/haptics", () => ({
  haptic: vi.fn(),
}));

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** ISO date string whose month/day match today's LOCAL calendar. */
const dobToday = (year: number) => {
  const now = new Date();
  return `${year}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** ISO date string for tomorrow's LOCAL month/day (wraps month/year safely). */
const dobTomorrow = (year: number) => {
  const t = new Date();
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  return `${year}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
};

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("BirthdayGreeting", () => {
  it("shows the greeting on the user's birthday using the profile name", () => {
    render(<BirthdayGreeting name="Ananthu Menon" dateOfBirth={dobToday(1998)} />);
    expect(screen.getByTestId("birthday-greeting")).toBeInTheDocument();
    expect(screen.getByText(/Happy Birthday, Ananthu!/)).toBeInTheDocument();
    expect(screen.getByText(/Wishing you an amazing year ahead/)).toBeInTheDocument();
  });

  it("shows nothing when it is not the birthday", () => {
    render(<BirthdayGreeting name="Ananthu" dateOfBirth={dobTomorrow(1998)} />);
    expect(screen.queryByTestId("birthday-greeting")).not.toBeInTheDocument();
  });

  it("shows nothing when date_of_birth is NULL", () => {
    render(<BirthdayGreeting name="Ananthu" dateOfBirth={null} />);
    expect(screen.queryByTestId("birthday-greeting")).not.toBeInTheDocument();
  });

  it("matches a different birth year with the same month/day", () => {
    const thisYear = new Date().getFullYear();
    render(<BirthdayGreeting name="Ananthu" dateOfBirth={dobToday(thisYear - 27)} />);
    expect(screen.getByTestId("birthday-greeting")).toBeInTheDocument();
  });

  it("falls back to a generic greeting without a name", () => {
    render(<BirthdayGreeting name={null} dateOfBirth={dobToday(1990)} />);
    expect(screen.getByText(/^Happy Birthday!$/)).toBeInTheDocument();
  });

  it("appears only once per session — dismissing marks it shown for the day", async () => {
    const user = userEvent.setup();
    const first = render(
      <BirthdayGreeting name="Ananthu" dateOfBirth={dobToday(1998)} />
    );
    await user.click(screen.getByRole("button", { name: /Thank you/i }));
    expect(screen.queryByTestId("birthday-greeting")).not.toBeInTheDocument();

    // Remount (e.g. navigating back to the dashboard) — still hidden.
    first.unmount();
    render(<BirthdayGreeting name="Ananthu" dateOfBirth={dobToday(1998)} />);
    expect(screen.queryByTestId("birthday-greeting")).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(1);
  });

  it("stays hidden when the greeting was already shown earlier this session", () => {
    const key = `finsight:birthday-shown:${new Date().getFullYear()}-${pad(
      new Date().getMonth() + 1
    )}-${pad(new Date().getDate())}`;
    sessionStorage.setItem(key, "1");
    render(<BirthdayGreeting name="Ananthu" dateOfBirth={dobToday(1998)} />);
    expect(screen.queryByTestId("birthday-greeting")).not.toBeInTheDocument();
  });
});
