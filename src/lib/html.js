import sanitizeHtml from 'sanitize-html';

const linkTransform = sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'nofollow noopener' });

export const sanitizeAbout = (html) =>
  sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'div'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: linkTransform },
  });

export const sanitizePost = (html) =>
  sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'div', 'h2', 'h3', 'blockquote', 'pre', 'code', 'img', 'figure', 'figcaption', 'iframe', 'hr'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
      iframe: ['src', 'allowfullscreen', 'allow', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https'], iframe: ['https'] },
    allowedIframeHostnames: ['www.youtube-nocookie.com', 'www.youtube.com'],
    allowIframeRelativeUrls: false,
    transformTags: { a: linkTransform },
  });

export function excerptOf(html, length = 180) {
  const text = sanitizeHtml(String(html || '').replace(/<\/(p|h2|h3|li|blockquote|div)>/gi, ' '), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

export function firstImage(html) {
  const m = /<img[^>]+src="(https:\/\/[^"]+)"/i.exec(String(html || ''));
  return m ? m[1] : '';
}
