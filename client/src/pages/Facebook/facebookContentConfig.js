export const FACEBOOK_POST_TRUNCATE_LENGTH = 200;

export const formatFacebookContentTime = (timestamp, locale) => {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString(locale);
  } catch {
    return timestamp;
  }
};
