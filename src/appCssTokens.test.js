const fs = require('fs');
const path = require('path');

test('App.css uses semantic colors outside its token mapping block', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8');
  expect(css.match(/\/\* color-token-mapping:start \*\/[\s\S]*?\/\* color-token-mapping:end \*\//g)).toHaveLength(1);

  const outsideMapping = css.replace(/\/\* color-token-mapping:start \*\/[\s\S]*?\/\* color-token-mapping:end \*\//, '');
  const modalPrimary = outsideMapping.match(/\.modal-btn-primary\s*\{[^}]*\}/);
  expect(modalPrimary).not.toBeNull();
  expect(modalPrimary[0]).toMatch(/color:\s*#ffffff\s*;/i);

  const withoutAllowedWhite = outsideMapping.replace(modalPrimary[0], modalPrimary[0].replace(/color:\s*#ffffff\s*;/i, ''));
  expect(withoutAllowedWhite).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\s*\(/i);
});
