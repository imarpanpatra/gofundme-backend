const ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (ID.test(value)) return value;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      if (m) id = m[2];
    }
  }
  return id && ID.test(id) ? id : null;
}

export const youTubeEmbedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}`;
