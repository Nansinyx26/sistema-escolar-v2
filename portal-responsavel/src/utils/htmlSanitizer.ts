import DOMPurify from 'dompurify';

export const sanitizeHtml = (html: string | null | undefined): string => {
  if (!html) {
    return '';
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });
};