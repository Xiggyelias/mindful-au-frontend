/** Post-login destination for students (skips dashboard flash when check-in is required). */
export function getStudentHomePath(user: { needs_assessment?: boolean } | null | undefined): string {
  return user?.needs_assessment ? "/student/diagnostic-assessment" : "/student/dashboard";
}
