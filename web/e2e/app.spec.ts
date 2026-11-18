import { expect, test, openReady, expectAccessible, failCamera } from './fixtures';

test('RU/KZ switches independently from output language and persists @phone', async ({ page }) => {
  await openReady(page);
  await page.getByRole('button', { name: 'ҚАЗ', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ымды тану');
  await page.getByLabel('Дыбыстау тілі', { exact: true }).selectOption('ru');
  await expect(page.getByLabel('Дыбыстау тілі', { exact: true })).toHaveValue('ru');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
});

test('personal gestures ask a signed-out visitor to sign in', async ({ page }) => {
  await openReady(page);
  await expect(page.getByRole('heading', { name: 'Свои жесты', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Войти или создать аккаунт' })).toBeVisible();
});

test('switching to the alphabet preserves the text draft', async ({ page }) => {
  await openReady(page);
  await page.getByLabel('Текст результата', { exact: true }).fill('Тест');
  await page.getByRole('button', { name: 'Русский алфавит', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Русский алфавит', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Текст результата', { exact: true })).toHaveValue('Тест');
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
