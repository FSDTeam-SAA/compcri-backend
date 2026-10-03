/// Whether [user] reads clock times as 15:00 rather than 3:00 PM.
///
/// An explicit choice wins. Otherwise the phone's own setting, as the app last
/// reported it, and failing that the convention of the user's language:
/// English speakers mostly use 12-hour, Portuguese and Spanish 24-hour.
export const uses24Hour = (user) => {
  if (user?.timeFormat === 'H24') return true;
  if (user?.timeFormat === 'H12') return false;
  if (typeof user?.deviceUses24Hour === 'boolean') return user.deviceUses24Hour;
  return (user?.locale || 'en') !== 'en';
};
