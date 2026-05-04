import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import CounselorMessages from "./CounselorMessages";

/**
 * Peers bookmarking /counselor/messages are sent to /peer/chats while counselors use Messages here.
 */
const CounselorMessagesPortal = () => {
  const { role } = useAuth();
  const location = useLocation();

  if (role === "peer_counselor") {
    const suffix = `${location.search}${location.hash}`;
    return <Navigate to={`/peer/chats${suffix}`} replace />;
  }

  return <CounselorMessages />;
};

export default CounselorMessagesPortal;
