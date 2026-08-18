/**
 * Who is allowed to use slash commands at all.
 *
 * Entries may be Discord user IDs (all digits) or usernames. IDs are safer:
 * a username can be changed by its owner, and whoever takes the old name
 * inherits the access. Right-click a user in Discord with Developer Mode on
 * to copy their ID.
 *
 * An empty list means no restriction — everyone can use the commands, subject
 * to the per-command Discord permissions.
 */
export function isOwner(user, owners) {
  if (!owners?.length) return true;

  const identities = new Set(
    [user?.id, user?.username, user?.globalName, user?.tag]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase()),
  );

  return owners.some((owner) =>
    identities.has(String(owner).trim().toLowerCase().replace(/^@/, '')),
  );
}
