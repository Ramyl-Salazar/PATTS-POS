export function filterStudents(students, query) {
  const normalized = String(query ?? "").trim().toLocaleLowerCase("en-PH");
  if (!normalized) return students;
  return students.filter((student) => `${student.name} ${student.id}`.toLocaleLowerCase("en-PH").includes(normalized));
}
