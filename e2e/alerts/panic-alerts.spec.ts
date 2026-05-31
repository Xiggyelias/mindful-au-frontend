import { test, expect } from "../fixtures/cmsTest";

test.describe("panic and emergency alert routing", () => {
  test("panic escalations alert professional staff but not peer counselors", async ({ cmsApi }) => {
    const admin = await cmsApi.login("admin");
    const counselor = await cmsApi.login("counselor");
    const peer = await cmsApi.login("peer_counselor");
    const student = await cmsApi.login("student");
    if (!admin.ok) {
      test.skip(true, admin.message);
      return;
    }
    if (!counselor.ok) {
      test.skip(true, counselor.message);
      return;
    }
    if (!peer.ok) {
      test.skip(true, peer.message);
      return;
    }
    if (!student.ok) {
      test.skip(true, student.message);
      return;
    }

    const ids = await cmsApi.seedUserIds(admin.token);
    const existingOpenSessions = await cmsApi.openSessionIds(admin.token);
    const cleanupSessionIds = new Set<number>();
    const reason = `e2e panic routing ${Date.now()}`;
    let panicLogId: number | null = null;

    try {
      const directSession = await cmsApi.createCounselorSession(admin.token, ids);
      if (existingOpenSessions.has(Number(directSession.id))) {
        test.skip(true, "Seeded counselor/student session already exists; skipping non-isolated panic flow.");
        return;
      }
      cleanupSessionIds.add(Number(directSession.id));

      const peerSession = await cmsApi.assignPeer(admin.token, Number(directSession.id), ids.peerCounselorId);
      if (existingOpenSessions.has(Number(peerSession.id))) {
        test.skip(true, "A peer support room already exists for the seed case; skipping panic isolation assertions.");
        return;
      }
      cleanupSessionIds.add(Number(peerSession.id));

      const panicResponse = await cmsApi.post(`/sessions/${peerSession.id}/panic-escalate`, student.token, {
        reason,
        location: "playwright-e2e",
      });
      expect(panicResponse.ok()).toBe(true);
      const panicBody = await panicResponse.json();
      panicLogId = Number(panicBody.panic_log_id ?? 0) || null;

      const counselorNotifications = await cmsApi.unreadNotifications(counselor.token);
      const adminNotifications = await cmsApi.unreadNotifications(admin.token);
      const peerNotifications = await cmsApi.unreadNotifications(peer.token);

      expect(
        counselorNotifications.some((notification) => String(notification.message ?? "").includes(reason)),
      ).toBe(true);
      expect(adminNotifications.some((notification) => String(notification.message ?? "").includes(reason))).toBe(true);
      expect(peerNotifications.some((notification) => String(notification.message ?? "").includes(reason))).toBe(false);
    } finally {
      if (panicLogId !== null) {
        await cmsApi.put(`/panic-logs/${panicLogId}`, admin.token, { resolved: true });
      }
      for (const sessionId of cleanupSessionIds) {
        await cmsApi.safeDeleteSession(admin.token, sessionId);
      }
    }
  });
});
