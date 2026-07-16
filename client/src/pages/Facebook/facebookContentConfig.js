export const FACEBOOK_POST_TRUNCATE_LENGTH = 200;

const textValue = value => String(value || '').trim();

const firstPostAttachment = post => (
  Array.isArray(post?.attachments?.data) ? post.attachments.data[0] : null
);

const firstMeaningfulLine = value => textValue(value)
  .split(/\r?\n/)
  .map(line => line.trim())
  .find(line => line && !/^https?:\/\//i.test(line) && !/^#[^\s]+$/.test(line));

export const buildFacebookPostProductDraft = (post = {}, fallbackName = '') => {
  const attachment = firstPostAttachment(post);
  const message = textValue(post.message);
  const attachmentDescription = textValue(attachment?.description);
  const attachmentTitle = textValue(attachment?.title);
  const name = (
    attachmentTitle
    || firstMeaningfulLine(message)
    || firstMeaningfulLine(attachmentDescription)
    || textValue(fallbackName)
  ).slice(0, 160);
  const imageUrl = textValue(
    post.full_picture
    || attachment?.media?.image?.src
    || attachment?.media?.source
  );
  const productUrl = textValue(attachment?.url || post.permalink_url);

  return {
    sku: '',
    name,
    description: message || attachmentDescription,
    price: '',
    currency: 'LYD',
    image_url: imageUrl,
    product_url: productUrl,
    category: '',
    availability: 'available',
    is_active: true,
  };
};

export const formatFacebookContentTime = (timestamp, locale) => {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString(locale);
  } catch {
    return timestamp;
  }
};
