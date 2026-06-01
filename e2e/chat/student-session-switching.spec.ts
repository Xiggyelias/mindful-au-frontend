import type { Page, Route } from "@playwright/test";
import { test, expect } from "../fixtures/cmsTest";
import { injectAuthToken } from "../support/auth";

type MockSession = {
  id: number;
  student_id: number;
  counselor_id: number;
  peer_counselor_id: number | null;
  assigned_role: "counselor" | "peer_counselor";
  status: "active";
  session_type: "chat";
  is_anonymous: boolean;
  anonymous_id: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
  counselor: {
    id: number;
    email: string;
    is_online: boolean;
    profile: { full_name: string };
  };
  peer_counselor?: {
    id: number;
    email: string;
    is_online: boolean;
    profile: { full_name: string };
  } | null;
};

type MockMessage = {
  id: number;
  session_id: number;
  sender_id: number;
  sender_role: string;
  sender_display_name: string;
  recipient_id: number;
  content: string;
  created_at: string;
  seen_at: string | null;
  is_encrypted: false;
  message_type: "text";
};

const now = "2026-06-01T12:00:00.000Z";

const studentUser = {
  id: 7,
  email: "student.switching@example.com",
  profile: {
    full_name: "Student Switch",
    anonymous_mode: false,
  },
  roles: [{ role: "student", approved: true }],
  two_factor_enabled: false,
};

const counselorAlpha = {
  id: 21,
  email: "alpha@example.com",
  is_online: true,
  profile: { full_name: "Counselor Alpha" },
};

const counselorBeta = {
  id: 22,
  email: "beta@example.com",
  is_online: true,
  profile: { full_name: "Counselor Beta" },
};

const peerPam = {
  id: 31,
  email: "pam.peer@example.com",
  is_online: true,
  profile: { full_name: "Peer Pam" },
};

function makeSessions(): MockSession[] {
  return [
    {
      id: 101,
      student_id: studentUser.id,
      counselor_id: counselorAlpha.id,
      peer_counselor_id: null,
      assigned_role: "counselor",
      status: "active",
      session_type: "chat",
      is_anonymous: false,
      anonymous_id: null,
      unread_count: 2,
      created_at: "2026-06-01T09:00:00.000Z",
      updated_at: "2026-06-01T10:00:00.000Z",
      counselor: counselorAlpha,
      peer_counselor: null,
    },
    {
      id: 102,
      student_id: studentUser.id,
      counselor_id: counselorBeta.id,
      peer_counselor_id: null,
      assigned_role: "counselor",
      status: "active",
      session_type: "chat",
      is_anonymous: false,
      anonymous_id: null,
      unread_count: 1,
      created_at: "2026-06-01T09:05:00.000Z",
      updated_at: "2026-06-01T10:05:00.000Z",
      counselor: counselorBeta,
      peer_counselor: null,
    },
    {
      id: 201,
      student_id: studentUser.id,
      counselor_id: counselorAlpha.id,
      peer_counselor_id: peerPam.id,
      assigned_role: "peer_counselor",
      status: "active",
      session_type: "chat",
      is_anonymous: false,
      anonymous_id: null,
      unread_count: 3,
      created_at: "2026-06-01T09:10:00.000Z",
      updated_at: "2026-06-01T10:10:00.000Z",
      counselor: counselorAlpha,
      peer_counselor: peerPam,
    },
  ];
}

function makeMessages(): Record<number, MockMessage[]> {
  return {
    101: [
      {
        id: 1001,
        session_id: 101,
        sender_id: counselorAlpha.id,
        sender_role: "counselor",
        sender_display_name: "Counselor Alpha",
        recipient_id: studentUser.id,
        content: "Alpha counselor history",
        created_at: now,
        seen_at: null,
        is_encrypted: false,
        message_type: "text",
      },
    ],
    102: [
      {
        id: 1002,
        session_id: 102,
        sender_id: counselorBeta.id,
        sender_role: "counselor",
        sender_display_name: "Counselor Beta",
        recipient_id: studentUser.id,
        content: "Beta counselor history",
        created_at: now,
        seen_at: null,
        is_encrypted: false,
        message_type: "text",
      },
    ],
    201: [
      {
        id: 2001,
        session_id: 201,
        sender_id: peerPam.id,
        sender_role: "peer_counselor",
        sender_display_name: "Peer Pam",
        recipient_id: studentUser.id,
        content: "Peer support history",
        created_at: now,
        seen_at: null,
        is_encrypted: false,
        message_type: "text",
      },
    ],
  };
}

async function installStudentChatApiMock(page: Page, sessionFixture?: MockSession[]) {
  const sessions = sessionFixture ?? makeSessions();
  const messages = makeMessages();

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();

    const json = async (body: unknown, status = 200) => {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    };

    if (method === "GET" && apiPath === "/me") {
      await json(studentUser);
      return;
    }

    if (method === "POST" && apiPath === "/me/presence") {
      await json({ ok: true });
      return;
    }

    if (method === "GET" && apiPath === "/sessions/chat-list") {
      await json({
        data: sessions,
        meta: {
          page: 1,
          per_page: 24,
          total: sessions.length,
          total_pages: 1,
        },
      });
      return;
    }

    const sessionMatch = apiPath.match(/^\/sessions\/(\d+)$/);
    if (method === "GET" && sessionMatch) {
      const session = sessions.find((item) => item.id === Number(sessionMatch[1]));
      await json(session ?? { message: "Not found" }, session ? 200 : 404);
      return;
    }

    const messagesMatch = apiPath.match(/^\/sessions\/(\d+)\/messages$/);
    if (method === "GET" && messagesMatch) {
      await json(messages[Number(messagesMatch[1])] ?? []);
      return;
    }

    const readMatch = apiPath.match(/^\/sessions\/(\d+)\/messages\/read$/);
    if (method === "POST" && readMatch) {
      const session = sessions.find((item) => item.id === Number(readMatch[1]));
      if (session) session.unread_count = 0;
      await json({ ok: true });
      return;
    }

    if (method === "GET" && /^\/sessions\/\d+\/typing$/.test(apiPath)) {
      await json({ is_typing: false });
      return;
    }

    if (method === "POST" && /^\/sessions\/\d+\/typing$/.test(apiPath)) {
      await json({ ok: true });
      return;
    }

    if (method === "POST" && /^\/sessions\/\d+\/touch$/.test(apiPath)) {
      await json({ ok: true });
      return;
    }

    if (method === "GET" && apiPath === "/users/counselors") {
      await json({ data: [counselorAlpha, counselorBeta], meta: { page: 1, total_pages: 1, total: 2 } });
      return;
    }

    if (method === "GET" && apiPath === "/student/incoming-calls") {
      await json([]);
      return;
    }

    if (method === "GET" && apiPath === "/chat/incoming-digest") {
      await json({ after_id: 0, messages: [] });
      return;
    }

    await json({ ok: true });
  });

  return { sessions, messages };
}

function sessionCard(page: Page, sessionId: number) {
  return page.locator(`[data-testid="student-chat-session-card-${sessionId}"]:visible`).first();
}

async function expectActiveSession(
  page: Page,
  sessionId: number,
  headerText: string,
  messageText: string,
  options?: { visibleCard?: boolean },
) {
  await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));
  await expect(page.getByRole("heading", { name: headerText })).toBeVisible();
  await expect(page.getByText(messageText)).toBeVisible();
  if (options?.visibleCard !== false) {
    await expect(sessionCard(page, sessionId)).toHaveAttribute("aria-pressed", "true");
  }
}

test.describe("student chat session switching", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuthToken(page, "mock-student-token");
  });

  test("switches counselor A to counselor B and keeps message histories independent", async ({ page }) => {
    await installStudentChatApiMock(page);
    await page.goto("/student/chat");
    await sessionCard(page, 101).click();
    await expectActiveSession(page, 101, "Counselor Alpha", "Alpha counselor history");

    await sessionCard(page, 102).click();
    await expectActiveSession(page, 102, "Counselor Beta", "Beta counselor history");
    await expect(page.getByText("Alpha counselor history")).toBeHidden();
  });

  test("switches counselor to peer support and back without merging conversations", async ({ page }) => {
    await installStudentChatApiMock(page);
    await page.goto("/student/chat");
    await sessionCard(page, 101).click();
    await expectActiveSession(page, 101, "Counselor Alpha", "Alpha counselor history");

    await sessionCard(page, 201).click();
    await expectActiveSession(page, 201, "Peer Pam", "Peer support history");
    await expect(page.getByText("Supervised Peer Support Chat")).toBeVisible();
    await expect(page.getByText("Alpha counselor history")).toBeHidden();

    await sessionCard(page, 101).click();
    await expectActiveSession(page, 101, "Counselor Alpha", "Alpha counselor history");
    await expect(page.getByText("Peer support history")).toBeHidden();
  });

  test("deduplicates duplicate active direct counselor rows before rendering", async ({ page }) => {
    const sessions = makeSessions();
    sessions.push({
      ...sessions[0],
      id: 103,
      is_anonymous: true,
      anonymous_id: "User_0103",
      unread_count: 5,
      created_at: "2026-06-01T09:15:00.000Z",
      updated_at: "2026-06-01T10:15:00.000Z",
    });

    await installStudentChatApiMock(page, sessions);
    await page.goto("/student/chat");

    await expect(
      page.locator(`[data-support-role="counselor"][data-support-id="${counselorAlpha.id}"]:visible`),
    ).toHaveCount(1);
    await expect(page.locator('[data-testid="student-chat-session-card-101"]:visible')).toHaveCount(0);
    await expect(sessionCard(page, 103)).toBeVisible();
    await expect(sessionCard(page, 201)).toBeVisible();
  });

  test("supports mobile card selection and close-to-sidebar flow", async ({ page }) => {
    await installStudentChatApiMock(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/student/chat");

    await expect(sessionCard(page, 201)).toBeVisible();
    await sessionCard(page, 201).click();
    await expectActiveSession(page, 201, "Peer Pam", "Peer support history", { visibleCard: false });

    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(page).toHaveURL(/\/student\/chat$/);
    await expect(sessionCard(page, 101)).toBeVisible();

    await sessionCard(page, 102).click();
    await expectActiveSession(page, 102, "Counselor Beta", "Beta counselor history", { visibleCard: false });
  });

  test("clears the active conversation when the base chat route is restored", async ({ page }) => {
    await installStudentChatApiMock(page);
    await page.goto("/student/chat");

    await sessionCard(page, 101).click();
    await expectActiveSession(page, 101, "Counselor Alpha", "Alpha counselor history");

    await page.getByRole("button", { name: "Chat" }).first().click();

    await expect(page).toHaveURL(/\/student\/chat$/);
    await expect(page.getByRole("heading", { name: "Counselor Alpha" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Welcome to Your Counseling Space" })).toBeVisible();
    await sessionCard(page, 102).click();
    await expectActiveSession(page, 102, "Counselor Beta", "Beta counselor history");
  });

  test("refreshes the selected session after an incoming digest event", async ({ page }) => {
    const { messages } = await installStudentChatApiMock(page);
    await page.goto("/student/chat");

    await sessionCard(page, 102).click();
    await expectActiveSession(page, 102, "Counselor Beta", "Beta counselor history");

    messages[102].push({
      id: 1003,
      session_id: 102,
      sender_id: counselorBeta.id,
      sender_role: "counselor",
      sender_display_name: "Counselor Beta",
      recipient_id: studentUser.id,
      content: "Realtime beta update",
      created_at: now,
      seen_at: null,
      is_encrypted: false,
      message_type: "text",
    });

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("mindful:chat-incoming-digest", {
          detail: { session_ids: [102] },
        }),
      );
    });

    await expect(page.getByText("Realtime beta update")).toBeVisible();
  });
});
