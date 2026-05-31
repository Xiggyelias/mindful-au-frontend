import { test, expect } from "../fixtures/cmsTest";

test.describe("admin case controls", () => {
  test("admin can create, assign, and return a supervised peer case", async ({ cmsApi }) => {
    const admin = await cmsApi.login("admin");
    if (!admin.ok) {
      test.skip(true, admin.message);
      return;
    }

    const ids = await cmsApi.seedUserIds(admin.token);
    const existingOpenSessions = await cmsApi.openSessionIds(admin.token);
    const cleanupSessionIds = new Set<number>();

    try {
      const directSession = await cmsApi.createCounselorSession(admin.token, ids);
      if (existingOpenSessions.has(Number(directSession.id))) {
        test.skip(true, "Seeded counselor/student session already exists; skipping destructive assignment flow.");
        return;
      }
      cleanupSessionIds.add(Number(directSession.id));

      expect(directSession.student_id).toBe(ids.studentId);
      expect(directSession.counselor_id).toBe(ids.counselorId);
      expect(directSession.assigned_role ?? "counselor").toBe("counselor");

      const peerSession = await cmsApi.assignPeer(admin.token, Number(directSession.id), ids.peerCounselorId);
      if (existingOpenSessions.has(Number(peerSession.id))) {
        test.skip(true, "A peer support room already exists for the seed case; skipping destructive return flow.");
        return;
      }
      cleanupSessionIds.add(Number(peerSession.id));

      expect(peerSession.student_id).toBe(ids.studentId);
      expect(peerSession.counselor_id).toBe(ids.counselorId);
      expect(peerSession.peer_counselor_id).toBe(ids.peerCounselorId);
      expect(peerSession.assigned_role).toBe("peer_counselor");

      const returnedSession = await cmsApi.unassignPeer(admin.token, Number(directSession.id));
      expect(returnedSession.id).toBe(peerSession.id);
      expect(returnedSession.status).toBe("completed");
    } finally {
      for (const sessionId of cleanupSessionIds) {
        await cmsApi.safeDeleteSession(admin.token, sessionId);
      }
    }
  });
});
