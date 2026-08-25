export function accountNameForSession(session, profile) {
  const isAdmin = ['STAFF', 'SUPER_ADMIN'].includes(session?.user_type);
  if (isAdmin) return session?.display_name || session?.username || '';
  return profile?.name || session?.username || '';
}

export function canManageTeacherAccounts(session) {
  return session?.user_type === 'SUPER_ADMIN';
}
