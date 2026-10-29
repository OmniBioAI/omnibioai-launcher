const { test, expect } = require('@playwright/test');

const GiB = 1024 ** 3;
const profiles = [
  { id: 'generic-python', name: 'Generic Python', preferred_ide: 'jupyterlab', resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0 }, required_capabilities: ['python'] },
  { id: 'generic-r', name: 'Generic R', preferred_ide: 'rstudio', resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0 }, required_capabilities: ['r'] },
];

async function mockLauncher(page) {
  const calls = { launch: 0 };
  await page.route('**/api/dev/objects/**', (route) => {
    const url = route.request().url();
    const object = { object_id: 'dataset-42', name: 'Fixture dataset', object_type: 'DatasetObject', metadata: { status: 'done', size: '12 samples' } };
    return route.fulfill({ json: url.includes('/dataset-42/') ? object : { objects: [object], count: 1, has_next: false } });
  });
  await page.route('**/api/launcher/**', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.endsWith('/v1/profiles')) return route.fulfill({ json: { profiles, resource_limits: { cpu: 16, memory_bytes: 64 * GiB, gpu: 2 } } });
    if (url.includes('/status/')) return route.fulfill({ json: { status: url.endsWith('/jupyter') ? 'running' : 'stopped' } });
    if (url.endsWith('/v1/workspaces/validate')) return route.fulfill({ json: {
      specification: { workspace: { profile: 'generic-python' }, ide: { type: 'jupyterlab' }, resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0, architecture: 'amd64' }, objects: [] },
      environment: { id: 'local-jupyterlab', ide: 'jupyterlab', architectures: ['amd64'], capabilities: ['python'], gpu_available: 0 },
    } });
    if (url.endsWith('/v1/workspaces') && request.method() === 'POST') {
      calls.launch += 1;
      return route.fulfill({ json: { workspace_id: 'workspace-1' } });
    }
    return route.fulfill({ status: 501, json: { error: 'not configured in browser test' } });
  });
  return calls;
}

async function auditTextContrast(page) {
  return page.locator('.workspace-shell').evaluate((root) => {
    const parse = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    const composite = (front, back) => front.length > 3 && front[3] < 1
      ? front.slice(0, 3).map((channel, index) => channel * front[3] + back[index] * (1 - front[3]))
      : front.slice(0, 3);
    const luminance = ([r, g, b]) => {
      const channel = [r, g, b].map((value) => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
      return .2126 * channel[0] + .7152 * channel[1] + .0722 * channel[2];
    };
    const contrast = (first, second) => {
      const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
      return (light + .05) / (dark + .05);
    };
    const selectors = [
      '.eyebrow', '.step-number', '.optional-label', '.profile-ide', '.profile-resources', '.ide-choice-copy > span',
      '.status-badge', '.service-description', '.service-unavailable', '.field-help', '.field-error', '.resource-grid label > span',
      '.resource-grid small', '.advanced-details', '.review-list dt', '.validation-pill', '.resolved-environment > span',
      '.review-objects code', '.security-note', '.launch-panel > p', '.launch-helper', '.workflow-step a', '.object-type',
    ].join(',');
    return [...root.querySelectorAll(selectors)].flatMap((element) => {
      const style = getComputedStyle(element);
      if (!element.textContent.trim() || style.display === 'none' || style.visibility === 'hidden') return [];
      const layers = [];
      for (let layer = element; layer && layer !== document.documentElement; layer = layer.parentElement) layers.push(layer);
      let backdrop = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
      for (const layer of layers.reverse()) {
        const color = parse(getComputedStyle(layer).backgroundColor);
        if (color.length >= 3 && !(color[0] === 0 && color[1] === 0 && color[2] === 0 && color[3] === 0)) backdrop = composite(color, backdrop);
      }
      const size = parseFloat(style.fontSize);
      const ratio = contrast(parse(style.color), backdrop);
      return size < 11 || ratio < 4.5 ? [{ text: element.textContent.trim().slice(0, 50), size, ratio }] : [];
    });
  });
}

async function auditRegionsContrast(page, selector) {
  return page.locator(selector).evaluateAll((regions) => {
    const parse = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    const composite = (front, back) => front.length > 3 && front[3] < 1
      ? front.slice(0, 3).map((channel, index) => channel * front[3] + back[index] * (1 - front[3]))
      : front.slice(0, 3);
    const luminance = ([r, g, b]) => {
      const channels = [r, g, b].map((value) => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
    return regions.flatMap((region) => [region, ...region.querySelectorAll('*')].flatMap((element) => {
      const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const style = getComputedStyle(element);
      if (!hasText || element.closest('[aria-hidden="true"]') || style.display === 'none' || style.visibility === 'hidden') return [];
      const layers = [];
      for (let layer = element; layer && layer !== document.documentElement; layer = layer.parentElement) layers.push(layer);
      let backdrop = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
      for (const layer of layers.reverse()) {
        const color = parse(getComputedStyle(layer).backgroundColor);
        if (color.length >= 3 && !(color[0] === 0 && color[1] === 0 && color[2] === 0 && color[3] === 0)) backdrop = composite(color, backdrop);
      }
      const ratio = contrast(parse(style.color), backdrop);
      return ratio < 4.5 ? [{ text: element.textContent.trim().slice(0, 50), ratio }] : [];
    }));
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  for (const theme of ['dark', 'light']) {
    test.describe(`${viewport.width}px launcher — ${theme} theme`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await mockLauncher(page);
        await page.goto(`/?obai_theme=${theme}`);
        await expect(page.getByRole('radio', { name: /Generic Python/ })).toBeVisible();
        await page.screenshot({ path: `/tmp/launcher-polish-after-${theme}-${viewport.width}.png`, fullPage: true });
      });

      test('keeps launch safe, selections keyboard-accessible, and copy/targets legible', async ({ page }) => {
        let launchRequests = 0;
        page.on('request', (request) => {
          if (request.url().endsWith('/v1/workspaces') && request.method() === 'POST') launchRequests += 1;
        });
        const services = page.getByRole('region', { name: 'Running services' });
        const environments = page.getByRole('region', { name: 'Select Environment' });
        await expect(services.getByRole('button', { name: 'Open ↗' })).toHaveCount(1);
        await expect(environments.getByRole('button', { name: 'Open ↗' })).toHaveCount(0);

        const launch = page.getByRole('button', { name: 'Launch Workspace' });
        await expect(launch).toBeDisabled();
        await expect(launch).toHaveAttribute('aria-disabled', 'true');
        await expect(page.getByText('Validate the configuration to enable launch.')).toBeVisible();
        await expect(launch).toHaveCSS('cursor', 'not-allowed');
        const disabledStyle = await launch.evaluate((button) => ({
          background: getComputedStyle(button).backgroundColor,
          color: getComputedStyle(button).color,
          surface: getComputedStyle(button.parentElement).backgroundColor,
        }));
        expect(disabledStyle.background).not.toBe(disabledStyle.surface);
        await launch.click({ force: true });
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(launchRequests).toBe(0);

        const tracker = page.getByRole('navigation', { name: 'Workspace workflow' });
        await expect(tracker).toBeVisible();
        await expect(tracker.locator('a[aria-current="step"]')).toHaveCount(1);
        await expect(tracker.locator('a[aria-current="step"]')).toContainText('Compute');
        expect(await tracker.boundingBox()).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
        const launchColumn = await page.locator('.workspace-layout').boundingBox();
        expect((await tracker.boundingBox()).width).toBeCloseTo(launchColumn.width, 0);
        await tracker.getByRole('link', { name: /Profile/ }).click();

        const python = page.getByRole('radio', { name: /Generic Python/ });
        await python.focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('radio', { name: /Generic R/ })).toHaveAttribute('aria-checked', 'true');
        const jupyter = page.getByRole('radio', { name: /JupyterLab/ });
        await jupyter.focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('radio', { name: /RStudio/ })).toHaveAttribute('aria-checked', 'true');

        const serviceCard = services.locator('.service-card').first();
        const cardLayout = await serviceCard.evaluate((card) => {
          const row = card.querySelector('.service-card-heading .ide-choice-icon').getBoundingClientRect();
          const badge = card.querySelector('.status-badge').getBoundingClientRect();
          const description = card.querySelector('.service-description').getBoundingClientRect();
          return { rowCenter: row.top + row.height / 2, badgeCenter: badge.top + badge.height / 2, descriptionTop: description.top, descriptionLeft: description.left, cardLeft: card.getBoundingClientRect().left };
        });
        expect(cardLayout.descriptionTop).toBeGreaterThan(cardLayout.rowCenter);
        expect(cardLayout.badgeCenter).toBeCloseTo(cardLayout.rowCenter, 0);
        expect(cardLayout.descriptionLeft).toBeLessThan(cardLayout.cardLeft + 30);

        const objectInput = page.getByLabel('OmniBioAI object reference');
        await expect(objectInput.locator('xpath=following-sibling::button[normalize-space()="Browse"]')).toBeVisible();
        await page.getByRole('button', { name: 'Browse' }).click();
        const picker = page.getByRole('dialog', { name: 'Choose an OmniBioAI object' });
        await expect(picker.getByText('OmniBioAI Objects')).toBeVisible();
        await picker.getByRole('button', { name: 'Select Fixture dataset' }).click();
        await expect(page.getByLabel('Attached objects')).toContainText('dataset-42');
        await objectInput.fill('not-an-object');
        await expect(page.getByText(/Use omnibioai:\/\//)).toBeVisible();

        for (const [sliderName, numberName] of [['CPU', 'CPU value'], ['Memory (GiB)', 'Memory value in GiB'], ['GPU', 'GPU value']]) {
          await expect(page.getByRole('slider', { name: sliderName })).toBeVisible();
          await expect(page.getByRole('spinbutton', { name: numberName })).toBeVisible();
        }

        const contrastFailures = await auditTextContrast(page);
        expect(contrastFailures).toEqual([]);
        const undersized = await page.locator('.workspace-shell button, .workspace-shell input, .workspace-shell select, .workspace-shell summary, .workspace-shell [role="radio"], .workspace-shell [role="button"], .workspace-shell a').evaluateAll((elements) => elements.flatMap((element) => {
          if (element.disabled || getComputedStyle(element).display === 'none') return [];
          const box = element.getBoundingClientRect();
          return box.width < 44 || box.height < 44 ? [{ name: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 30), width: box.width, height: box.height }] : [];
        }));
        expect(undersized).toEqual([]);
      });
    });
  }
}

test('light purple object view, toast, install modal, and embedded header keep token contrast', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockLauncher(page);
  await page.goto('/?object_id=test&obai_theme=light&obai_accent=purple');
  await expect(page.locator('.object-card')).toContainText('TCGA-BRCA');
  await expect(page.getByRole('button', { name: 'Open in JupyterLab' })).toBeVisible();
  expect(await auditRegionsContrast(page, '.type-badge, .object-card')).toEqual([]);
  await page.screenshot({ path: '/tmp/launcher-polish-light-purple-object.png', fullPage: true });

  await expect(page.locator('.env-card--selected')).toBeVisible();
  const accentColors = await page.evaluate(() => {
    const normalize = (value) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = value;
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };
    const root = getComputedStyle(document.documentElement);
    return {
      accent: normalize(root.getPropertyValue('--color-accent')),
      border: normalize(root.getPropertyValue('--color-accent-border')),
      launch: getComputedStyle(document.querySelector('.launch-btn')).backgroundColor,
      selectedBorder: getComputedStyle(document.querySelector('.env-card--selected')).borderTopColor,
    };
  });
  expect(accentColors.launch).toBe(accentColors.accent);
  expect(accentColors.selectedBorder).toBe(accentColors.border);
  await expect(page.locator('.env-card--selected')).toHaveCSS('border-color', accentColors.border);
  expect(await auditRegionsContrast(page, '.object-card, .type-badge, .env-card, .env-badge, .launch-btn, .install-help-trigger')).toEqual([]);

  await page.locator('.env-card').nth(1).click();
  const toast = page.getByRole('status').filter({ hasText: 'Opening VS Code…' });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS('opacity', '1');
  expect(await auditRegionsContrast(page, '.toast')).toEqual([]);
  await page.screenshot({ path: '/tmp/launcher-polish-light-purple-toast.png', fullPage: true });

  await page.getByRole('button', { name: 'Need help installing?' }).click();
  const modal = page.getByRole('dialog', { name: 'VS Code not detected' });
  await expect(modal).toBeVisible();
  expect(await auditRegionsContrast(page, '.modal-card')).toEqual([]);
  await page.screenshot({ path: '/tmp/launcher-polish-light-purple-modal.png', fullPage: true });
  await page.getByRole('button', { name: 'Dismiss' }).click();

  await page.setContent('<iframe title="Embedded launcher" src="http://127.0.0.1:4303/?obai_theme=light&obai_accent=purple" style="width:100%;height:900px;border:0"></iframe>');
  const embedded = page.frameLocator('iframe');
  await expect(embedded.getByRole('heading', { name: 'Workspace Launcher' })).toBeVisible();
  await expect(embedded.locator('.brand-lockup')).toHaveCSS('display', 'none');
  await page.locator('iframe').screenshot({ path: '/tmp/launcher-polish-embedded-topbar.png' });
});
