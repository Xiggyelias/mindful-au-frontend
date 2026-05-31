import { test, expect } from "../fixtures/cmsTest";

test.describe("chat message contract", () => {
  test("student/counselor chat is two-way and peer messages stay isolated", async ({ cmsApi }) => {
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
    const marker = `e2e-${Date.now()}`;

    try {
      const directSession = await cmsApi.createCounselorSession(admin.token, ids);
      if (existingOpenSessions.has(Number(directSession.id))) {
        test.skip(true, "Seeded counselor/student session already exists; skipping non-isolated chat flow.");
        return;
      }
      cleanupSessionIds.add(Number(directSession.id));

      const studentToCounselor = await cmsApi.sendMessage(
        student.token,
        Number(directSession.id),
        `${marker} student to counselor`,
      );
      expect(studentToCounselor.recipient_id).toBe(ids.counselorId);

      const counselorMessages = await cmsApi.sessionMessages(counselor.token, Number(directSession.id));
      expect(counselorMessages.some((message) => message.content === `${marker} student to counselor`)).toBe(true);

      const counselorToStudent = await cmsApi.sendMessage(
        counselor.token,
        Number(directSession.id),
        `${marker} counselor to student`,
      );
      expect(counselorToStudent.recipient_id).toBe(ids.studentId);

      const studentMessages = await cmsApi.sessionMessages(student.token, Number(directSession.id));
      expect(studentMessages.some((message) => message.content === `${marker} counselor to student`)).toBe(true);

      const deletionTarget = await cmsApi.sendMessage(
        counselor.token,
        Number(directSession.id),
        `${marker} delete me`,
      );
      expect(deletionTarget.delete_for_everyone_until).toEqual(expect.any(String));

      const deleteResponse = await cmsApi.delete(
        `/sessions/${directSession.id}/messages/${deletionTarget.id}`,
        counselor.token,
      );
      expect(deleteResponse.ok()).toBe(true);
      const deleteBody = await deleteResponse.json();
      expect(deleteBody.ok).toBe(true);
      expect(deleteBody.message.is_deleted).toBe(true);

      const peerSession = await cmsApi.assignPeer(admin.token, Number(directSession.id), ids.peerCounselorId);
      if (existingOpenSessions.has(Number(peerSession.id))) {
        test.skip(true, "A peer support room already exists for the seed case; skipping isolation assertions.");
        return;
      }
      cleanupSessionIds.add(Number(peerSession.id));

      const counselorCursor = await cmsApi.incomingDigest(counselor.token, 0);
      const studentToPeer = await cmsApi.sendMessage(student.token, Number(peerSession.id), `${marker} student to peer`);
      expect(studentToPeer.recipient_id).toBe(ids.peerCounselorId);

      const peerMessages = await cmsApi.sessionMessages(peer.token, Number(peerSession.id));
      expect(peerMessages.some((message) => message.content === `${marker} student to peer`)).toBe(true);

      const counselorDigest = await cmsApi.incomingDigest(counselor.token, counselorCursor.after_id);
      expect(counselorDigest.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ message_id: studentToPeer.id })]),
      );
    } finally {
      for (const sessionId of cleanupSessionIds) {
        await cmsApi.safeDeleteSession(admin.token, sessionId);
      }
    }
  });
});
