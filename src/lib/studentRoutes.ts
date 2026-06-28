/** Post-login destination for students. */
export function getStudentHomePath(_user?: { needs_assessment?: boolean } | null): string {
  return "/student/dashboard";
}
