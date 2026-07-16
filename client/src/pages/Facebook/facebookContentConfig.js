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

export const buildFacebookPostLibraryDraft = (
  post = {},
  linkedPageId,
  { duplicate = false, fallbackTitle = '' } = {}
) => {
  const attachment = firstPostAttachment(post);
  const body = textValue(post.message || attachment?.description);
  const title = (
    textValue(attachment?.title)
    || firstMeaningfulLine(body)
    || textValue(fallbackTitle)
  ).slice(0, 160);

  return {
    linked_page_id: linkedPageId,
    source_post_id: textValue(post.id),
    source_post_url: textValue(post.permalink_url),
    title,
    body,
    media_url: textValue(
      post.full_picture
      || attachment?.media?.image?.src
      || attachment?.media?.source
    ),
    link_url: textValue(attachment?.url),
    duplicate,
  };
};

export const buildFacebookProductPostText = (product, locale) => {
  if (!product) return '';
  const price = Number(product.price || 0);
  return [
    textValue(product.name),
    textValue(product.description),
    price ? `${price.toLocaleString(locale || undefined)} ${textValue(product.currency || 'LYD')}` : '',
    textValue(product.product_url),
  ].filter(Boolean).join('\n\n');
};

export const formatFacebookContentTime = (timestamp, locale) => {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString(locale);
  } catch {
    return timestamp;
  }
};
