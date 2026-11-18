import { expect, test, openReady, expectAccessible, failCamera, injectClip } from './fixtures';

test('RU/KZ switches independently from output language and persists @phone', async ({ page }) => {
  await openReady(page);
  await page.getByRole('button', { name: 'ҚАЗ', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ымды және ерінді тану');
  await page.getByLabel('Мәтін және дыбыстау тілі', { exact: true }).selectOption('ru');
  await expect(page.getByLabel('Мәтін және дыбыстау тілі', { exact: true })).toHaveValue('ru');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
});

test('KRSL performs real inference on a labelled recorded example', async ({ page }) => {
  await openReady(page);
  await page.getByRole('link', { name: 'Словарь и примеры', exact: true }).click();
  await page.getByText('Проверить KRSL без камеры', { exact: true }).click();
  await page.getByText('Словарь и проверка', { exact: true }).click();
  const run = page.getByRole('button', { name: 'Распознать записанный пример', exact: true });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByText(/Записанный тестовый пример, не камера/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Где (место) 100%', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Где (место) 100%', exact: true }).click();
  await expect(page.getByLabel('Текст результата', { exact: true })).toHaveValue('Где (место)');
  await expect(page.getByRole('button', { name: 'Озвучить', exact: true })).toBeEnabled();
});

test('model switch preserves the conversation draft and exposes a different camera path', async ({
  page,
}) => {
  await openReady(page);
  await page.getByLabel('Текст результата', { exact: true }).fill('Тест');
  await page.getByLabel('Жестовый язык / модель', { exact: true }).selectOption('rsl');
  await expect(
    page.getByRole('heading', { name: 'Русский жестовый язык', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Контрольная запись без камеры', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Текст результата', { exact: true })).toHaveValue('Тест');
});

test('ASL retains original recognizer and translates the labels', async ({ page }) => {
  await openReady(page);
  await page.getByLabel('Жестовый язык / модель', { exact: true }).selectOption('asl');
  await expect(page.getByRole('tab', { name: 'Распознавание', exact: true })).toBeVisible();
  await injectClip(page, 0);
  await expect(page.getByTestId('recognise-result')).not.toHaveText('Результат появится здесь');
  await page.getByRole('tab', { name: 'Распознавание', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Тренировка ASL', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('camera denial leaves an actionable localized error @phone', async ({ page }) => {
  await failCamera(page, 'NotAllowedError');
  await openReady(page);
  await page.getByRole('button', { name: 'Включить камеру', exact: true }).click();
  await expect(page.getByTestId('camera-problem')).toContainText('Доступ к камере запрещён');
});

test('initial page is keyboard labelled and has no axe violations @phone', async ({ page }) => {
  await openReady(page);
  await expectAccessible(page);
});
