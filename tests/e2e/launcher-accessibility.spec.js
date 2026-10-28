const { test, expect } = require('@playwright/test');

const GiB = 1024 ** 3;
const profiles = [
  { id: 'generic-python', name: 'Generic Python', preferred_ide: 'jupyterlab', resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0 }, required_capabilities: ['python'] },
  { id: 'generic-r', name: 'Generic R', preferred_ide: 'rstudio', resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0 }, required_capabilities: ['r'] },
];

async function mockLauncher(page) {
  await page.route('**/api/launcher/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/v1/profiles')) return route.fulfill({ json: { profiles, resource_limits: { cpu: 16, memory_bytes: 64 * GiB, gpu: 2 } } });
    if (url.includes('/status/')) return route.fulfill({ json: { status: url.endsWith('/jupyter') ? 'running' : 'stopped' } });
    if (url.endsWith('/v1/workspaces/validate')) return route.fulfill({ json: {
      specification: { workspace: { profile: 'generic-python' }, ide: { type: 'jupyterlab' }, resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0, architecture: 'amd64' }, objects: [] },
      environment: { id: 'local-jupyterlab', ide: 'jupyterlab', architectures: ['amd64'], capabilities: ['python'], gpu_available: 0 },
    } });
    return route.fulfill({ status: 501, json: { error: 'not configured in browser test' } });
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px launcher`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockLauncher(page);
      await page.goto('/');
      await expect(page.getByRole('radio', { name: /Generic Python/ })).toBeVisible();
    });

    test('covers launcher requirements 1–7, contrast, and target size', async ({ page }) => {
      // 1. Running services are separate actions, never environment selectors.
      const services = page.getByRole('region', { name: 'Running services' });
      const environments = page.getByRole('region', { name: 'Select Environment' });
      await expect(services.getByRole('button', { name: 'Open ↗' })).toHaveCount(1);
      await expect(environments.getByRole('button', { name: 'Open ↗' })).toHaveCount(0);

      // 2. Launch remains gated by server validation.
      const launch = page.getByRole('button', { name: 'Launch Workspace' });
      await expect(launch).toBeDisabled();
      await page.getByRole('button', { name: 'Validate configuration' }).click();
      await expect(page.getByText('Validated', { exact: true })).toBeVisible();
      await expect(launch).toBeEnabled();

      // 3. The disconnected six-step bar was removed.
      await expect(page.getByLabel('Workspace workflow')).toHaveCount(0);

      // 4. Selection is a roving, arrow-key radio group with checked state.
      const python = page.getByRole('radio', { name: /Generic Python/ });
      await python.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: /Generic R/ })).toHaveAttribute('aria-checked', 'true');
      const jupyter = page.getByRole('radio', { name: /JupyterLab/ });
      await jupyter.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('radio', { name: /RStudio/ })).toHaveAttribute('aria-checked', 'true');

      // 5. Browse is next to the object field and malformed URIs fail inline.
      const objectInput = page.getByLabel('OmniBioAI object reference');
      await expect(objectInput.locator('xpath=following-sibling::button[normalize-space()="Browse"]')).toBeVisible();
      await objectInput.fill('not-an-object');
      await expect(page.getByText(/Use omnibioai:\/\//)).toBeVisible();

      // 6. Every slider has a labelled number input.
      for (const [sliderName, numberName] of [['CPU', 'CPU value'], ['Memory (GiB)', 'Memory value in GiB'], ['GPU', 'GPU value']]) {
        await expect(page.getByRole('slider', { name: sliderName })).toBeVisible();
        await expect(page.getByRole('spinbutton', { name: numberName })).toBeVisible();
      }

      // 7. Visible small copy is >=12px and meets WCAG AA against its painted ancestor.
      const failures = await page.locator('#main-content').evaluate((root) => {
        const parse = (value) => (value.match(/[\d.]+/g) || []).map(Number);
        const composite = (front, back) => front.length > 3 && front[3] < 1
          ? front.slice(0, 3).map((channel, index) => channel * front[3] + back[index] * (1 - front[3]))
          : front.slice(0, 3);
        const luminance = ([r, g, b]) => {
          const channel = [r, g, b].map((v) => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
          return .2126 * channel[0] + .7152 * channel[1] + .0722 * channel[2];
        };
        const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
        return [...root.querySelectorAll('*')].flatMap((element) => {
          const style = getComputedStyle(element);
          if (!element.childNodes.length || ![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) || element.closest('[aria-hidden="true"]') || style.display === 'none' || style.visibility === 'hidden') return [];
          let backdrop = [10, 12, 16];
          const layers = [];
          for (let background = element; background; background = background.parentElement) layers.push(background);
          for (const background of layers.reverse()) {
            const color = parse(getComputedStyle(background).backgroundColor);
            if (color.length >= 3 && !(color[0] === 0 && color[1] === 0 && color[2] === 0 && color[3] === 0)) backdrop = composite(color, backdrop);
          }
          const size = parseFloat(style.fontSize);
          const ratio = contrast(parse(style.color), backdrop);
          return size < 12 || ratio < 4.5 ? [{ text: element.textContent.trim().slice(0, 40), size, ratio }] : [];
        });
      });
      expect(failures).toEqual([]);

      const undersized = await page.locator('#main-content button, #main-content input, #main-content select, #main-content summary, #main-content [role="radio"]').evaluateAll((elements) => elements.flatMap((element) => {
        if (element.disabled || getComputedStyle(element).display === 'none') return [];
        const box = element.getBoundingClientRect();
        return box.width < 44 || box.height < 44 ? [{ name: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 30), width: box.width, height: box.height }] : [];
      }));
      expect(undersized).toEqual([]);
    });
  });
}
