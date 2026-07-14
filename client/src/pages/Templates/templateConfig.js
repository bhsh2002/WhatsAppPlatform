import { tx } from '../../i18n/tx';

export const createTemplateDraft = (template = null) => ({
  name: template?.name || '',
  language: template?.language || 'ar',
  category: template?.category || 'UTILITY',
  header_type: template?.header_type || 'none',
  header_content: template?.header_content || '',
  body: template?.body || '',
  footer: template?.footer || ''
});

export const buildMetaTemplateComponents = (data) => {
  const components = [];
  if (data.header_type && data.header_type !== 'none') {
    const header = { type: 'HEADER' };
    if (data.header_type === 'text') {
      header.format = 'TEXT';
      header.text = data.header_content || '';
      const headerVars = (data.header_content || '').match(/\{\{[^}]+\}\}/g);
      if (headerVars) {
        header.example = {
          header_text: headerVars.map(() => tx('auto.k_b40d4b44b21d'))
        };
      }
    } else if (data.header_type === 'location') {
      header.format = 'LOCATION';
    } else {
      header.format = data.header_type.toUpperCase();
    }
    components.push(header);
  }

  const body = {
    type: 'BODY',
    text: data.body
  };
  const bodyVars = (data.body || '').match(/\{\{[^}]+\}\}/g);
  if (bodyVars) {
    body.example = {
      body_text: [bodyVars.map(() => tx('auto.k_b40d4b44b21d'))]
    };
  }
  components.push(body);

  if (data.footer) {
    components.push({
      type: 'FOOTER',
      text: data.footer
    });
  }
  return components;
};

export const getTemplateCategoryLabel = (category) => ({
  UTILITY: tx('auto.k_24db4b5a9540'),
  MARKETING: tx('auto.k_c0ce6624f02c'),
  AUTHENTICATION: tx('auto.k_fe79250b3ff2')
}[category] || category);
