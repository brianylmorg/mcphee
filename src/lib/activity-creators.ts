export function normalizeActivityCreators<
  T extends { created_by?: unknown },
>(rows: T[], users: Array<{ name?: unknown }>): Array<T & { created_by: string | null }> {
  const namesByKey = new Map<string, string>();
  users.forEach((user) => {
    if (typeof user.name !== "string" || !user.name.trim()) return;
    namesByKey.set(user.name.trim().toLowerCase(), user.name.trim());
  });

  const importedCreator = namesByKey.get("jy") ?? null;
  return rows.map((row) => {
    const storedName = typeof row.created_by === "string" ? row.created_by.trim() : "";
    if (!storedName) return { ...row, created_by: null };

    const registeredName = namesByKey.get(storedName.toLowerCase());
    if (registeredName) return { ...row, created_by: registeredName };
    if (storedName.toLowerCase() === "agrippa" && importedCreator) {
      return { ...row, created_by: importedCreator };
    }

    // Keep the original attribution for names that no longer match a current
    // household user (departed users, legacy rows) rather than dropping it.
    return { ...row, created_by: storedName };
  });
}
