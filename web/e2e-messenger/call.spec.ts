import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { expectAccessible } from '../e2e/fixtures';

/**
 * Headless Chromium on macOS cannot open even the fake microphone (the request
 * never settles), so the microphone is replaced by a synthetic WebAudio tone.
 * The camera stays Chromium's fake video device.
 */
async function newMediaContext(browser: Browser, mobile = false): Promise<BrowserContext> {
  const context = await browser.newContext({
    ...(mobile ? devices['iPhone 13'] : {}),
    permissions: ['camera', 'microphone'],
    reducedMotion: 'reduce',
  });
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
  if (mobile) {
    await context.addInitScript(() => {
      const create = window.createImageBitmap.bind(window);
      window.createImageBitmap = (source: ImageBitmapSource, ...args: unknown[]) => {
        if (source instanceof HTMLVideoElement) {
          throw new DOMException('Video ImageBitmap unavailable', 'NotSupportedError');
        }
        return Reflect.apply(create, window, [source, ...args]) as Promise<ImageBitmap>;
      };
      // The wrapper forwards the WebGL context with Reflect.apply.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const upload = WebGL2RenderingContext.prototype.texImage2D;
      WebGL2RenderingContext.prototype.texImage2D = function (
        this: WebGL2RenderingContext,
        ...args: unknown[]
      ) {
        if (
          !performance.getEntriesByName('call-landmark-frame').length &&
          args.some((arg) => arg instanceof HTMLVideoElement && arg.closest('.self-view'))
        )
          performance.mark('call-landmark-frame');
        Reflect.apply(upload, this, args);
      };
    });
  }
  return context;
}

async function register(
  browser: Browser,
  username: string,
  name: string,
  { mobile = false, auditAccessibility = false } = {},
) {
  const context = await newMediaContext(browser, mobile);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./#chats');
  if (auditAccessibility) await expectAccessible(page);
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  if (auditAccessibility) await expectAccessible(page);
  await page.getByLabel('Ваше имя (видно собеседникам)').fill(name);
  await page.getByLabel('Имя пользователя для входа').fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill(`${username}-password`);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  const id = (await page.locator('.my-id-card .copy-id b').innerText()).trim();
  expect(id).toMatch(/^ST-[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.locator('.conn-state')).toHaveText('онлайн');
  return { context, page, id, errors };
}

async function sendRecognizedSign(page: Page, peerId: string, body: string) {
  const token = await page.evaluate(() => localStorage.getItem('signtalk.token'));
  const response = await page.request.post(`/api/chats/${peerId}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { kind: 'sign', body },
  });
  await expect(response).toBeOK();
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
  const alice = await register(browser, 'alice', 'Алия', { auditAccessibility: true });
  const bob = await register(browser, 'bob', 'Болат', { auditAccessibility: true });

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

test('mobile fallback processes live camera frames and receives signs while history is loading', async ({
  browser,
}) => {
  const desktop = await register(browser, 'desktop', 'Айжан');
  const phone = await register(browser, 'phone', 'Арман', { mobile: true });
  const historyPath = `**/api/chats/${desktop.id}/messages?*`;
  let releaseHistory!: () => void;
  const history = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  await sendRecognizedSign(desktop.page, phone.id, 'Из предыдущего разговора');
  await phone.page.reload();
  await expect(phone.page.locator('.conn-state')).toHaveText('онлайн');
  await expect(phone.page.locator('.contact-row', { hasText: 'Айжан' })).toBeVisible();
  await phone.page.route(historyPath, async (route) => {
    const response = await route.fetch();
    await history;
    await route.fulfill({ response });
  });

  try {
    const historyRequested = phone.page.waitForRequest(historyPath);
    await desktop.page.locator('.contact-row', { hasText: 'Арман' }).click();
    await desktop.page.locator('.call-button').click();
    await phone.page.getByRole('alertdialog').getByRole('button', { name: 'Ответить' }).click();
    await historyRequested;
    await Promise.all([remoteVideoPlaying(phone.page), remoteVideoPlaying(desktop.page)]);

    // Check the real MediaPipe fallback with the fake camera, and inject the resulting text
    // at the message API so the delivery assertion does not depend on a person signing.
    await expect
      .poll(
        () => phone.page.evaluate(() => performance.getEntriesByName('call-landmark-frame').length),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    await expect(phone.page.locator('.hands-chip')).toContainText('покажите руки');

    await sendRecognizedSign(desktop.page, phone.id, 'Жест с ноутбука');
    const subtitle = phone.page.locator('.subtitles .kind-sign');
    await expect(subtitle).toHaveText('Жест с ноутбука');
    await expect(subtitle).toBeInViewport();

    const historyLoaded = phone.page.waitForResponse(historyPath);
    releaseHistory();
    await historyLoaded;
    await phone.page.getByRole('button', { name: 'Панель перевода и чата' }).click();
    await expect(phone.page.locator('.transcript li')).toHaveText(['Жест с ноутбука']);

    await sendRecognizedSign(phone.page, desktop.id, 'Жест с телефона');
    await expect(desktop.page.locator('.subtitles .kind-sign')).toHaveText('Жест с телефона');
    await phone.page.getByRole('button', { name: 'Закрыть панель' }).click();
    await desktop.page.getByRole('button', { name: 'Завершить звонок' }).click();
    await phone.page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await phone.page.locator('.contact-row', { hasText: 'Айжан' }).click();
    await expect(phone.page.locator('.bubble-row', { hasText: 'Жест с ноутбука' })).toHaveCount(1);
    await expect(phone.page.locator('.bubble-row', { hasText: 'Жест с телефона' })).toHaveCount(1);
    expect([...desktop.errors, ...phone.errors]).toEqual([]);
  } finally {
    releaseHistory();
    await Promise.all([desktop.context.close(), phone.context.close()]);
  }
});
