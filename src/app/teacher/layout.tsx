import { TeacherGuard } from "./TeacherGuard";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TeacherGuard>{children}</TeacherGuard>;
}
