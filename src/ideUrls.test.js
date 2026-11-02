import { ideBaseUrl, ideUrl } from './ideUrls';

describe('IDE URLs', () => {
  test('default to Studio\'s same-origin router paths', () => {
    const base = 'https://webstudio.omnibioai.org';
    expect(ideUrl('jupyterlab', { base })).toBe('https://webstudio.omnibioai.org/jupyter/');
    expect(ideUrl('rstudio', { base })).toBe('https://webstudio.omnibioai.org/rstudio/');
    expect(ideUrl('vscode', { base })).toBe('https://webstudio.omnibioai.org/vscode/');
    expect(ideUrl('terminal', { base })).toBe('https://webstudio.omnibioai.org/vscode/');
  });

  test('use the page origin when no public base is configured', () => {
    expect(ideBaseUrl(undefined, 'https://webstudio.omnibioai.org')).toBe('https://webstudio.omnibioai.org');
    expect(ideUrl('rstudio')).toBe(`${window.location.origin}/rstudio/`);
  });

  test('accept a configured http(s) base, with or without a path prefix', () => {
    expect(ideBaseUrl('https://studio.example.test/', 'https://page.test')).toBe('https://studio.example.test');
    expect(ideBaseUrl('https://studio.example.test/prefix/', 'https://page.test')).toBe('https://studio.example.test/prefix');
  });

  test('ignore an unparseable or non-http base rather than building a broken link', () => {
    expect(ideBaseUrl('not a url', 'https://page.test')).toBe('https://page.test');
    expect(ideBaseUrl('javascript:alert(1)', 'https://page.test')).toBe('https://page.test');
  });

  test('encode query parameters and reject unknown IDEs', () => {
    expect(ideUrl('jupyterlab', { base: 'https://s.test', query: { omnibioai_object_id: 'a b&c' } }))
      .toBe('https://s.test/jupyter/?omnibioai_object_id=a+b%26c');
    expect(ideUrl('shell', { base: 'https://s.test' })).toBeNull();
  });
});
