import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible } from '../e2e/fixtures';

/**
 * Headless Chromium on macOS cannot open even the fake microphone (the request
 * never settles), so the microphone is replaced by a synthetic WebAudio tone.
 * The camera stays Chromium's fake video device.
 */
async function newMediaContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await context.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = constraints?.video
        ? await original({ video: constraints.video })
        : new MediaStream();
      if (constraints?.audio) {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const sink = audio.createMediaStreamDestination();
        tone.connect(sink);
        tone.start();
        for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);
      }
      return stream;
    };
  });
  return context;
}

async function register(browser: Browser, username: string, name: string) {
  const context = await newMediaContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#chats');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await expectAccessible(page);
  await page.getByLabel('Ваше имя (видно собеседникам)').fill(name);
  await page.getByLabel('Имя пользователя для входа').fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill(`${username}-password`);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  const id = (await page.locator('.my-id-card .copy-id b').innerText()).trim();
  expect(id).toMatch(/^ST-[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.locator('.conn-state')).toHaveText('онлайн');
  return { context, page, id, errors };
}

async function login(browser: Browser, loginName: string) {
  const context = await newMediaContext(browser);
  const page = await context.newPage();
  await page.goto('./#chats');
  await page.getByLabel('Имя пользователя или ID').fill(loginName);
  await page.getByLabel('Пароль', { exact: true }).fill(`${loginName}-password`);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('.conn-state')).toHaveText('онлайн');
  return { context, page };
}

/** Real media is flowing when the remote <video> has decoded frames. */
async function remoteVideoPlaying(page: Page) {
  await expect
    .poll(() => page.locator('.remote-video').evaluate((v: HTMLVideoElement) => v.videoWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}

test('two people chat by unique ID, then talk on a video call with live sign translation', async ({
  browser,
}) => {
  const alice = await register(browser, 'alice', 'Алия');
  const bob = await register(browser, 'bob', 'Болат');

  // Bob finds Alice by her unique ID and writes to her.
  await bob.page.getByLabel('ID или имя пользователя собеседника').fill(alice.id.toLowerCase());
  await bob.page.getByRole('button', { name: 'Найти' }).click();
  await bob.page.getByRole('button', { name: 'Добавить' }).click();
  await bob.page.getByLabel('Текст сообщения').fill('Привет! Созвонимся?');
  await bob.page.getByLabel('Текст сообщения').press('Enter');
  await expect(bob.page.locator('.bubble-row.mine')).toContainText('Привет! Созвонимся?');

  // Alice receives it live, with an unread badge, and replies.
  const row = alice.page.locator('.contact-row', { hasText: 'Болат' });
  await expect(row.locator('.unread')).toHaveText('1');
  await row.click();
  await expect(alice.page.locator('.bubble-row').last()).toContainText('Привет! Созвонимся?');
  await alice.page.getByLabel('Текст сообщения').fill('Да, звони');
  await alice.page.getByLabel('Текст сообщения').press('Enter');
  await expect(bob.page.locator('.bubble-row').last()).toContainText('Да, звони');
  // Bob sees his message as read.
  await expect(
    bob.page.locator('.bubble-row.mine svg[aria-label="Прочитано"]').first(),
  ).toBeVisible();
  await expectAccessible(bob.page);

  // Video call: Bob calls, Alice answers.
  await bob.page.locator('.call-button').click();
  const incoming = alice.page.getByRole('alertdialog');
  await expect(incoming).toContainText('Болат');
  await incoming.getByRole('button', { name: 'Ответить' }).click();
  await remoteVideoPlaying(alice.page);
  await remoteVideoPlaying(bob.page);
  await expect(alice.page.locator('.call-top')).toContainText('Болат');

  // Sign translation runs on-device: the hand tracker and KRSL model load on the local video.
  await expect(alice.page.locator('.hands-chip')).toContainText(
    /покажите руки|руки видны|читаю жест/,
    {
      timeout: 60_000,
    },
  );

  // Text typed during the call reaches the other side as a subtitle.
  await bob.page.getByLabel('Сообщение собеседнику').fill('Вижу тебя!');
  await bob.page.getByLabel('Сообщение собеседнику').press('Enter');
  await expect(alice.page.locator('.subtitles')).toContainText('Вижу тебя!');
  await expectAccessible(alice.page);

  // And the other way round.
  await alice.page.getByLabel('Сообщение собеседнику').fill('Спасибо');
  await alice.page.getByLabel('Сообщение собеседнику').press('Enter');
  await expect(bob.page.locator('.subtitles')).toContainText('Спасибо');

  // Mute and camera toggles work.
  await bob.page.getByRole('button', { name: 'Выключить микрофон' }).click();
  await expect(bob.page.getByRole('button', { name: 'Включить микрофон' })).toBeVisible();

  // Alice hangs up; both see the end and the chat logs the call.
  await alice.page.getByRole('button', { name: 'Завершить звонок' }).click();
  await expect(bob.page.locator('.remote-placeholder')).toContainText('Звонок завершён');
  await expect(bob.page.locator('.call-log').last()).toContainText('Видеозвонок');
  await expect(alice.page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });

  // Second device: Alice signs in on another browser. A call rings on both, is answered on one.
  const alice2 = await login(browser, 'alice');
  await bob.page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 10_000 });
  await bob.page.locator('.call-button').click();
  await expect(alice.page.getByRole('alertdialog')).toBeVisible();
  await expect(alice2.page.getByRole('alertdialog')).toBeVisible();
  await alice2.page.getByRole('alertdialog').getByRole('button', { name: 'Ответить' }).click();
  await expect(alice.page.getByRole('alertdialog')).toBeHidden();
  await remoteVideoPlaying(alice2.page);
  await bob.page.getByRole('button', { name: 'Завершить звонок' }).click();
  await expect(alice2.page.locator('.remote-placeholder')).toContainText('Звонок завершён');

  // The profile lists both of Alice's devices.
  await alice.page.goto('./#profile');
  await expect(alice.page.locator('.device-list li')).toHaveCount(2);
  await expectAccessible(alice.page);

  expect([...alice.errors, ...bob.errors]).toEqual([]);
  await Promise.all([alice.context.close(), bob.context.close(), alice2.context.close()]);
});
